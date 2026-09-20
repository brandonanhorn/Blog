#!/usr/bin/env node
//
// Turns an Obsidian vault into src/index.json, which the Worker bundles at
// deploy time. Run by CI on every push to the vault repo; run by hand while
// developing.
//
//   node scripts/build-index.js <vault-dir> [output-path]
//   node scripts/build-index.js ~/Documents/brain
//
// WHAT GETS PUBLISHED
//
// The bot answers from whatever ends up in here, and the site is public. The
// policy below is an allowlist, so a folder you add later is private until you
// say otherwise. Per-note frontmatter overrides it in both directions:
//
//   ---
//   public: false     # keep this note out, even inside an allowed folder
//   ---
//
//   ---
//   public: true      # publish this note, even outside one
//   ---

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

import {
  extractTitle,
  splitIntoChunks,
  toPlainText,
  uniqueTokens,
  metaTokens
} from "../src/text.js";

const PUBLIC_FOLDERS = ["projects", "life", "notes"];

// Must stay BELOW MAX_CONTEXT_CHARS in src/retrieval.js (5200). A whole-note
// candidate larger than the retriever's context budget can never be selected,
// so indexing one is wasted work at best and crowds out usable chunks at worst.
const WHOLE_NOTE_MAX_LENGTH = 4500;
const MAX_CANDIDATES = 5000;

// Past this, the Worker's per-request scan starts to matter against the free
// plan's 10ms CPU budget. Build an inverted index or move to Vectorize.
const CPU_WARNING_THRESHOLD = 1000;

// Facts that have CHANGED. A note that still states the old version is worse
// than a missing note — it makes the whole site look stale to a recruiter —
// so the build fails rather than publishing it. Brandon left ATB Financial in
// September 2026; anything presenting it as his current job is wrong.
// Past tense is fine ("I led", "I owned", "processed"); these patterns only
// match present-tense forms.
const STALE_PATTERNS = [
  /\bcurrently\b[^.\n]{0,50}\bATB\b/i,
  /\bI(?:'m| am) (?:a |the )?(?:Senior )?Data Scientist at ATB\b/i,
  /\bAt ATB(?: Financial)?,? (?:where )?I (?:lead|own|run|deliver|use|score|treat|report|partner|compare|build|manage|coach)\b/i,
  /\bI (?:lead|own|run|manage|coach)\b[^.\n]{0,50}\bat ATB\b/i,
  /\b(?:now|today)\b[^.\n]{0,30}\bat ATB\b/i,
  /\bmy (?:day job|current (?:role|job|employer|team))\b[^.\n]{0,40}\bATB\b/i,
  /\bATB\b[^.\n]{0,40}\b(?:where I (?:work|am)|my current (?:role|job|employer))\b/i,
  /\b(?:pipelines?|program|system|platform) (?:that )?(?:process(?:es)?|handles?|runs?) (?:roughly |about |~)?35,?000\b/i,
];

function findStaleFacts(relativePath, markdown) {
  const hits = [];
  for (const [i, line] of markdown.split(/\r?\n/).entries()) {
    for (const pattern of STALE_PATTERNS) {
      const m = line.match(pattern);
      if (m) hits.push(`${relativePath}:${i + 1}  "${m[0]}"`);
    }
  }
  return hits;
}

const here = path.dirname(fileURLToPath(import.meta.url));

function collectMarkdown(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectMarkdown(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      found.push(full);
    }
  }
  return found;
}

// Deliberately not a YAML parser — we only care about one boolean, and a
// dependency here would have to be installed in CI.
function readPublicFlag(markdown) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    return null;
  }
  const flag = match[1].match(/^\s*public\s*:\s*(true|false)\s*$/im);
  return flag ? flag[1].toLowerCase() === "true" : null;
}

function topFolder(relativePath) {
  const parts = relativePath.split("/");
  return parts.length > 1 ? parts[0] : "";
}

function decide(relativePath, markdown) {
  const flag = readPublicFlag(markdown);
  if (flag === true) {
    return { include: true, why: "public: true" };
  }
  if (flag === false) {
    return { include: false, why: "public: false" };
  }
  const folder = topFolder(relativePath);
  if (PUBLIC_FOLDERS.includes(folder)) {
    return { include: true, why: `in ${folder}/` };
  }
  return { include: false, why: folder ? `${folder}/ not allowlisted` : "vault root" };
}

function candidate({ text, relativePath, fileName, folder, title, kind }) {
  return {
    text,
    filePath: relativePath,
    kind,
    tokens: {
      text: uniqueTokens(text),
      filePath: metaTokens(relativePath),
      fileName: metaTokens(fileName),
      folder: metaTokens(folder),
      title: metaTokens(title)
    }
  };
}

function main() {
  const vaultArg = process.argv[2];
  if (!vaultArg) {
    console.error("usage: node scripts/build-index.js <vault-dir> [output-path]");
    process.exit(1);
  }

  const vault = path.resolve(vaultArg.replace(/^~/, process.env.HOME || "~"));
  const output = path.resolve(process.argv[3] || path.join(here, "..", "src", "index.json"));

  if (!fs.existsSync(vault)) {
    console.error(`vault not found: ${vault}`);
    process.exit(1);
  }

  const files = collectMarkdown(vault);
  const candidates = [];
  const included = [];
  const skipped = [];
  const stale = [];

  for (const absolute of files) {
    const relativePath = path.relative(vault, absolute).split(path.sep).join("/");
    const markdown = fs.readFileSync(absolute, "utf8");

    const verdict = decide(relativePath, markdown);
    if (!verdict.include) {
      skipped.push(`${relativePath}  (${verdict.why})`);
      continue;
    }

    const plainText = toPlainText(markdown.replace(/^---\r?\n[\s\S]*?\r?\n---/, ""));
    if (!plainText) {
      skipped.push(`${relativePath}  (empty)`);
      continue;
    }

    stale.push(...findStaleFacts(relativePath, markdown));

    const title = extractTitle(markdown);
    const fileName = path.basename(relativePath, ".md");
    const dir = path.dirname(relativePath);
    const folder = dir === "." ? "" : dir;

    let added = 0;
    for (const text of splitIntoChunks(plainText)) {
      if (candidates.length >= MAX_CANDIDATES) break;
      candidates.push(candidate({ text, relativePath, fileName, folder, title, kind: "chunk" }));
      added += 1;
    }

    // Short notes also go in whole, so a question that matches the note as a
    // unit beats one that matches a fragment of it.
    if (plainText.length <= WHOLE_NOTE_MAX_LENGTH && candidates.length < MAX_CANDIDATES) {
      candidates.push(
        candidate({ text: plainText, relativePath, fileName, folder, title, kind: "full-note" })
      );
      added += 1;
    }

    included.push(`${relativePath}  (${added} candidate${added === 1 ? "" : "s"}, ${verdict.why})`);
  }

  // Version is a hash of the content, so a rebuild that changes nothing keeps
  // the same version — and the Worker's answer cache stays warm.
  const version = crypto
    .createHash("sha256")
    .update(JSON.stringify(candidates.map((c) => [c.filePath, c.kind, c.text])))
    .digest("hex")
    .slice(0, 12);

  if (stale.length) {
    console.error(
      `\nRefusing to build: ${stale.length} line${stale.length === 1 ? "" : "s"} still present ATB ` +
        "Financial as the current job. Move them to past tense, or remove the pattern from " +
        "STALE_PATTERNS if the fact has genuinely changed back.\n"
    );
    for (const hit of stale) console.error(`  ${hit}`);
    process.exit(1);
  }

  const index = { version, builtAt: new Date().toISOString(), candidates };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(index));

  const bytes = fs.statSync(output).size;

  console.log(`\nPublished (${included.length} note${included.length === 1 ? "" : "s"}):`);
  for (const line of included) console.log(`  + ${line}`);

  if (skipped.length) {
    console.log(`\nNot published (${skipped.length}):`);
    for (const line of skipped) console.log(`  - ${line}`);
  }

  console.log(
    `\n${candidates.length} candidates -> ${output} ` +
      `(${(bytes / 1024).toFixed(1)} KB, version ${version})`
  );

  if (!candidates.length) {
    console.error(
      "\nNothing was published, so the bot has nothing to answer from.\n" +
        `Allowlisted folders are: ${PUBLIC_FOLDERS.join(", ")}.\n` +
        "Add 'public: true' frontmatter to a note, or edit PUBLIC_FOLDERS in this file."
    );
    process.exit(1);
  }

  if (candidates.length > CPU_WARNING_THRESHOLD) {
    console.warn(
      `\nWarning: ${candidates.length} candidates is past the ${CPU_WARNING_THRESHOLD} mark ` +
        "where the Worker's per-request scan starts competing with the free plan's 10ms CPU " +
        "limit. Time to build an inverted index or move to Vectorize."
    );
  }
}

main();
