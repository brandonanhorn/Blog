import index from "./index.json";
import { tokenize, expandQueryTokens } from "./text.js";

// Keyword retrieval over the Obsidian vault, ported from
// ollama-chat-server/src/retrieval.js. The scoring is unchanged; what moved is
// where the chunks come from. There is no filesystem here — `index.json` is
// built by scripts/build-index.js and bundled at deploy time.
//
// The other change is CPU. `scoreCandidate` runs against every candidate on
// every question, and the Workers free plan allows 10ms of CPU per request. So
// the index ships de-duplicated token lists, and they are turned into Sets once
// at module scope rather than per request.
//
// That is comfortable at this vault's size. If the index grows past roughly a
// thousand candidates, stop scanning and build an inverted index in the build
// step, or move to Vectorize — see the plan.

// Trimmed from the local server's 6. Input is about two thirds of the neuron
// cost of a question, so this is the biggest single lever on the budget.
const TOP_K = 4;

// Hard ceiling on how much context can reach the prompt, so the budget gate's
// worst-case estimate stays honest no matter what retrieval returns.
export const MAX_CONTEXT_CHARS = 5200;

export const INDEX_VERSION = index.version;
export const INDEX_BUILT_AT = index.builtAt;
export const INDEX_SIZE = index.candidates.length;

const candidates = index.candidates.map((candidate) => ({
  text: candidate.text,
  filePath: candidate.filePath,
  kind: candidate.kind,
  sets: {
    text: new Set(candidate.tokens.text),
    filePath: new Set(candidate.tokens.filePath),
    fileName: new Set(candidate.tokens.fileName),
    folder: new Set(candidate.tokens.folder),
    title: new Set(candidate.tokens.title),
    combinedMeta: new Set([
      ...candidate.tokens.filePath,
      ...candidate.tokens.fileName,
      ...candidate.tokens.folder,
      ...candidate.tokens.title
    ])
  }
}));

function overlap(queryTokens, targetSet) {
  if (!targetSet.size) {
    return 0;
  }

  let hits = 0;
  for (const token of queryTokens) {
    if (targetSet.has(token)) {
      hits += 1;
    }
  }
  return hits;
}

function scoreCandidate(queryTokenSet, candidate) {
  const uniqueQueryCount = queryTokenSet.size || 1;
  const sets = candidate.sets;

  const textOverlap = overlap(queryTokenSet, sets.text);
  const fileNameOverlap = overlap(queryTokenSet, sets.fileName);
  const folderOverlap = overlap(queryTokenSet, sets.folder);
  const titleOverlap = overlap(queryTokenSet, sets.title);
  const pathOverlap = overlap(queryTokenSet, sets.filePath);

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

  if (queryTokenSet.has("career") && sets.combinedMeta.has("career")) {
    score += 2;
  }

  if (queryTokenSet.has("writing") && sets.folder.has("writing")) {
    score += 2;
  }

  if (candidate.kind === "full-note" && (fileNameOverlap > 0 || titleOverlap > 0 || folderOverlap > 0)) {
    score += 0.7;
  }

  return score;
}

export function getRelevantContext(query, topK = TOP_K) {
  const safeQuery = typeof query === "string" ? query.trim() : "";
  if (!safeQuery || !candidates.length) {
    return { context: "", sources: [] };
  }

  const baseTokens = tokenize(safeQuery);
  if (!baseTokens.length) {
    return { context: "", sources: [] };
  }

  const queryTokenSet = new Set(expandQueryTokens(baseTokens));

  const scored = [];
  for (const candidate of candidates) {
    const score = scoreCandidate(queryTokenSet, candidate);
    if (score > 0) {
      scored.push({ score, candidate });
    }
  }

  if (!scored.length) {
    return { context: "", sources: [] };
  }

  scored.sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, Math.min(Math.max(topK, 1), 6));

  const parts = [];
  const sources = [];
  let budget = MAX_CONTEXT_CHARS;

  for (const { candidate } of selected) {
    const block = `Source: ${candidate.filePath}\nContent:\n${candidate.text}`;
    // Skip what will not fit, never abort. This used to `break`, which meant a
    // single oversized candidate ranking first suppressed every smaller one
    // behind it and returned NO context at all — the bot then answered "I don't
    // have that information" for the very questions it matched best.
    if (block.length > budget) {
      continue;
    }
    budget -= block.length;
    parts.push(block);
    if (!sources.includes(candidate.filePath)) {
      sources.push(candidate.filePath);
    }
  }

  // Backstop: something scored, so the answer must not come back empty. If every
  // candidate was too large, send the best one truncated rather than nothing.
  if (!parts.length && selected.length) {
    const best = selected[0].candidate;
    parts.push(`Source: ${best.filePath}\nContent:\n${best.text.slice(0, MAX_CONTEXT_CHARS - 200)}`);
    sources.push(best.filePath);
  }

  return { context: parts.join("\n\n---\n\n"), sources };
}
