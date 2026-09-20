// Text handling shared by the Worker and the index builder.
//
// Both sides MUST tokenize identically. The builder writes token lists into
// index.json; the Worker tokenizes the incoming question and intersects the
// two. Change `tokenize` here and the index goes stale until it is rebuilt,
// so the build stamps a version that the answer cache keys off.
//
// Ported from ollama-chat-server/src/retrieval.js with no behaviour changes.

const CHUNK_MIN_SIZE = 500;
const CHUNK_MAX_SIZE = 1000;

export const PROFILE_SYNONYMS = {
  career: ["experience", "work", "job", "professional", "background", "resume", "summary"],
  hiring: ["career", "experience", "work", "professional"],
  skills: ["technical", "tools", "expertise"],
  projects: ["project", "built", "created"],
  writing: ["writing", "notes", "essays"]
};

export function normalizeToken(token) {
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

export function tokenize(text) {
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

// The index stores unique tokens rather than every occurrence. Scoring only
// ever asks "is this token present", so duplicates are pure weight.
export function uniqueTokens(text) {
  return Array.from(new Set(tokenize(text)));
}

export function expandQueryTokens(baseTokens) {
  const expanded = new Set(baseTokens);

  for (const token of baseTokens) {
    const synonymTerms = PROFILE_SYNONYMS[token];
    if (!synonymTerms) {
      continue;
    }

    for (const synonym of synonymTerms) {
      for (const synonymToken of tokenize(synonym)) {
        expanded.add(synonymToken);
      }
    }
  }

  return Array.from(expanded);
}

export function toPlainText(markdown) {
  return String(markdown || "")
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

export function extractTitle(markdown) {
  const match = String(markdown || "").match(/^\s{0,3}#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

export function splitIntoChunks(text) {
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

// Function words are stripped from FILENAME, FOLDER, TITLE and PATH tokens only.
// Those fields are weighted up to 2.8x, so a filename like
// "how_i_work_remotely_day_to_day" was matching "how does your RAG work" on
// "how" alone and beating the actual RAG note. Stopwords stay in body text,
// where the weight is 1x and normalised by query length.
export const STOPWORDS = new Set([
  "a", "about", "after", "again", "all", "also", "am", "an", "and", "any", "are", "as", "at",
  "be", "because", "been", "before", "being", "between", "both", "but", "by",
  "can", "could", "did", "do", "does", "doing", "done", "each", "few", "for", "from",
  "get", "got", "had", "has", "have", "how", "i", "if", "in", "into", "is", "it", "its",
  "me", "more", "most", "my", "not", "now", "of", "on", "only", "or", "other", "our", "own",
  "same", "should", "so", "some", "such", "than", "that", "the", "their", "them", "then",
  "there", "these", "they", "this", "those", "to", "too", "us", "very", "was", "we", "were",
  "what", "when", "where", "which", "while", "who", "why", "will", "with", "would",
  "you", "your", "yours"
]);

// Tokens for the metadata fields. Same tokenizer, function words removed.
export function metaTokens(text) {
  return uniqueTokens(text).filter((t) => !STOPWORDS.has(t));
}
