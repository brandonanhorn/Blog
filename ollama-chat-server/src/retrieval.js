"use strict";

const fs = require("fs");
const path = require("path");

const VAULT_PATH = "/Users/ban/Documents/brain";
const CHUNK_MIN_SIZE = 500;
const CHUNK_MAX_SIZE = 1000;
const MAX_CHUNKS = 20000;

let chunkStore = [];

function tokenize(text) {
  return text
    .toLowerCase()
    .match(/[a-z0-9]+/g) || [];
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

function scoreChunk(queryTokens, chunkTokens) {
  if (!queryTokens.length || !chunkTokens.length) {
    return 0;
  }

  const chunkTokenSet = new Set(chunkTokens);
  let overlap = 0;

  for (const token of queryTokens) {
    if (chunkTokenSet.has(token)) {
      overlap += 1;
    }
  }

  const uniqueQueryTerms = new Set(queryTokens).size;
  return uniqueQueryTerms ? overlap / uniqueQueryTerms : 0;
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

    for (const filePath of markdownFiles) {
      if (nextStore.length >= MAX_CHUNKS) {
        break;
      }

      const markdown = fs.readFileSync(filePath, "utf8");
      const plainText = toPlainText(markdown);
      const chunks = splitIntoChunks(plainText);

      for (const chunkText of chunks) {
        if (nextStore.length >= MAX_CHUNKS) {
          break;
        }

        nextStore.push({
          text: chunkText,
          tokens: tokenize(chunkText)
        });
      }
    }

    chunkStore = nextStore;
    console.log(`[retrieval] Loaded ${chunkStore.length} chunks from ${markdownFiles.length} markdown files.`);
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

  const queryTokens = tokenize(safeQuery);
  if (!queryTokens.length) {
    return "";
  }

  const scored = [];

  for (const chunk of chunkStore) {
    const score = scoreChunk(queryTokens, chunk.tokens);
    if (score > 0) {
      scored.push({ score, text: chunk.text });
    }
  }

  if (!scored.length) {
    return "";
  }

  scored.sort((a, b) => b.score - a.score);

  return scored
    .slice(0, Math.min(Math.max(topK, 3), 5))
    .map((entry) => entry.text)
    .join("\n\n---\n\n");
}

loadVaultChunks();

module.exports = {
  getRelevantContext
};
