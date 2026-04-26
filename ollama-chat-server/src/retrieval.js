"use strict";

const fs = require("fs");
const path = require("path");

const VAULT_PATH = "/Users/ban/Documents/brain";
const CHUNK_MIN_SIZE = 500;
const CHUNK_MAX_SIZE = 1000;
const MAX_CHUNKS = 20000;
const WHOLE_NOTE_MAX_LENGTH = 6000;

const PROFILE_SYNONYMS = {
  career: ["experience", "work", "job", "professional", "background", "resume", "summary"],
  hiring: ["career", "experience", "work", "professional"],
  skills: ["technical", "tools", "expertise"],
  projects: ["project", "built", "created"],
  writing: ["writing", "notes", "essays"]
};

let chunkStore = [];

function normalizeToken(token) {
  if (!token) {
    return "";
  }

  if (token.length > 4 && token.endsWith("ies")) {
    return `${token.slice(0, -3)}y`;
  }

  if (token.length > 4 && token.endsWith("es")) {
    return token.slice(0, -2);
  }

  if (token.length > 3 && token.endsWith("s")) {
    return token.slice(0, -1);
  }

  return token;
}

function tokenize(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/[_-]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ");

  const raw = normalized.match(/[a-z0-9]+/g) || [];
  const tokens = [];

  for (const token of raw) {
    tokens.push(token);

    const normalizedToken = normalizeToken(token);
    if (normalizedToken && normalizedToken !== token) {
      tokens.push(normalizedToken);
    }
  }

  return tokens;
}

function expandQueryTokens(baseTokens) {
  const expanded = new Set(baseTokens);

  for (const token of baseTokens) {
    const synonymTerms = PROFILE_SYNONYMS[token];
    if (!synonymTerms) {
      continue;
    }

    for (const synonym of synonymTerms) {
      const synonymTokens = tokenize(synonym);
      for (const synonymToken of synonymTokens) {
        expanded.add(synonymToken);
      }
    }
  }

  return Array.from(expanded);
}

function toPlainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]+\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[\*_~#>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTitle(markdown) {
  const match = String(markdown || "").match(/^\s{0,3}#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function splitIntoChunks(text) {
  if (!text) {
    return [];
  }

  const chunks = [];
  let cursor = 0;

  while (cursor < text.length) {
    let end = Math.min(cursor + CHUNK_MAX_SIZE, text.length);

    if (end < text.length) {
      const preferredBreaks = ["\n\n", ". ", "? ", "! ", "\n", " "];

      for (const separator of preferredBreaks) {
        const breakPoint = text.lastIndexOf(separator, end);
        if (breakPoint > cursor + CHUNK_MIN_SIZE) {
          end = breakPoint + separator.length;
          break;
        }
      }
    }

    const chunk = text.slice(cursor, end).trim();
    if (chunk.length >= Math.floor(CHUNK_MIN_SIZE / 2)) {
      chunks.push(chunk);
    }

    cursor = end;
  }

  return chunks;
}

function collectMarkdownFiles(dirPath) {
  let results = [];
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      results = results.concat(collectMarkdownFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results;
}

function buildCandidate({ text, filePath, fileName, folder, title, kind }) {
  const filePathTokens = tokenize(filePath);
  const fileNameTokens = tokenize(fileName);
  const folderTokens = tokenize(folder);
  const titleTokens = tokenize(title);
  const textTokens = tokenize(text);

  return {
    text,
    filePath,
    fileName,
    folder,
    title,
    kind,
    tokens: {
      text: textTokens,
      filePath: filePathTokens,
      fileName: fileNameTokens,
      folder: folderTokens,
      title: titleTokens,
      combinedMeta: [...filePathTokens, ...fileNameTokens, ...folderTokens, ...titleTokens]
    }
  };
}

function scoreOverlap(queryTokenSet, targetTokens) {
  if (!targetTokens.length) {
    return 0;
  }

  const targetSet = new Set(targetTokens);
  let overlap = 0;

  for (const token of queryTokenSet) {
    if (targetSet.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
}

function scoreCandidate(queryTokens, candidate) {
  const queryTokenSet = new Set(queryTokens);
  const uniqueQueryCount = queryTokenSet.size || 1;

  const textOverlap = scoreOverlap(queryTokenSet, candidate.tokens.text);
  const fileNameOverlap = scoreOverlap(queryTokenSet, candidate.tokens.fileName);
  const folderOverlap = scoreOverlap(queryTokenSet, candidate.tokens.folder);
  const titleOverlap = scoreOverlap(queryTokenSet, candidate.tokens.title);
  const pathOverlap = scoreOverlap(queryTokenSet, candidate.tokens.filePath);

  let score = textOverlap / uniqueQueryCount;
  score += (fileNameOverlap / uniqueQueryCount) * 2.8;
  score += (folderOverlap / uniqueQueryCount) * 2.0;
  score += (titleOverlap / uniqueQueryCount) * 2.2;
  score += (pathOverlap / uniqueQueryCount) * 1.5;

  if (folderOverlap > 0) {
    score += 0.8;
  }

  if (fileNameOverlap > 0) {
    score += 1.2;
  }

  if (titleOverlap > 0) {
    score += 0.8;
  }

  if (queryTokenSet.has("career") && candidate.tokens.combinedMeta.includes("career")) {
    score += 2;
  }

  if (queryTokenSet.has("writing") && candidate.tokens.folder.includes("writing")) {
    score += 2;
  }

  if (candidate.kind === "full-note" && (fileNameOverlap > 0 || titleOverlap > 0 || folderOverlap > 0)) {
    score += 0.7;
  }

  return score;
}

function loadVaultChunks() {
  if (!fs.existsSync(VAULT_PATH)) {
    console.warn(`[retrieval] Vault path not found: ${VAULT_PATH}`);
    chunkStore = [];
    return;
  }

  try {
    const markdownFiles = collectMarkdownFiles(VAULT_PATH);
    const nextStore = [];

    for (const absolutePath of markdownFiles) {
      if (nextStore.length >= MAX_CHUNKS) {
        break;
      }

      const markdown = fs.readFileSync(absolutePath, "utf8");
      const plainText = toPlainText(markdown);
      const title = extractTitle(markdown);
      const relativePath = path.relative(VAULT_PATH, absolutePath).replace(/\\/g, "/");
      const fileName = path.basename(relativePath, ".md");
      const folder = path.dirname(relativePath) === "." ? "" : path.dirname(relativePath).replace(/\\/g, "/");

      const chunks = splitIntoChunks(plainText);

      for (const chunkText of chunks) {
        if (nextStore.length >= MAX_CHUNKS) {
          break;
        }

        nextStore.push(
          buildCandidate({
            text: chunkText,
            filePath: relativePath,
            fileName,
            folder,
            title,
            kind: "chunk"
          })
        );
      }

      if (plainText.length > 0 && plainText.length <= WHOLE_NOTE_MAX_LENGTH && nextStore.length < MAX_CHUNKS) {
        nextStore.push(
          buildCandidate({
            text: plainText,
            filePath: relativePath,
            fileName,
            folder,
            title,
            kind: "full-note"
          })
        );
      }
    }

    chunkStore = nextStore;
    console.log(`[retrieval] Loaded ${chunkStore.length} candidates from ${markdownFiles.length} markdown files.`);
  } catch (error) {
    console.warn(`[retrieval] Failed to load vault notes: ${error.message}`);
    chunkStore = [];
  }
}

function getRelevantContext(query, topK = 4) {
  const safeQuery = typeof query === "string" ? query.trim() : "";
  if (!safeQuery || !chunkStore.length) {
    return "";
  }

  const baseTokens = tokenize(safeQuery);
  if (!baseTokens.length) {
    return "";
  }

  const queryTokens = expandQueryTokens(baseTokens);

  const scored = [];

  for (const candidate of chunkStore) {
    const score = scoreCandidate(queryTokens, candidate);
    if (score > 0) {
      scored.push({
        score,
        text: candidate.text,
        filePath: candidate.filePath,
        kind: candidate.kind
      });
    }
  }

  if (!scored.length) {
    return "";
  }

  scored.sort((a, b) => b.score - a.score);

  const cappedTopK = Math.min(Math.max(topK, 3), 6);
  const selected = scored.slice(0, cappedTopK);

  const debugMatches = selected.map((entry) => `${entry.filePath} (${entry.score.toFixed(3)})`);
  console.log(`[retrieval] top matches: ${debugMatches.join(", ")}`);

  return selected
    .map((entry) => `Source: ${entry.filePath}\nContent:\n${entry.text}`)
    .join("\n\n---\n\n");
}

loadVaultChunks();

module.exports = {
  getRelevantContext
};
