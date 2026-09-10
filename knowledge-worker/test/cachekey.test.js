import { describe, expect, it } from "vitest";
import { INDEX_VERSION } from "../src/retrieval.js";

// The cache key is what makes a hit safe: it has to collapse the questions
// that deserve the same answer, separate the ones that don't, and stop being
// valid the moment the notes change. These reimplement the key exactly as
// src/index.js builds it — if you change it there, change it here.

const normalize = (q) =>
  q
    .toLowerCase()
    .replace(/['\u2018\u2019]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

async function cacheKey(question, indexVersion = INDEX_VERSION) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${normalize(question)}|${indexVersion}`)
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("cache key", () => {
  it("treats trivially different phrasings of the same question as one", async () => {
    const base = await cacheKey("What are Brandon's technical skills?");

    for (const variant of [
      "what are brandons technical skills",
      "  What are Brandon's technical skills?  ",
      "What are Brandon's   technical skills???",
      "WHAT ARE BRANDON'S TECHNICAL SKILLS!"
    ]) {
      expect(await cacheKey(variant)).toBe(base);
    }
  });

  it("keeps genuinely different questions apart", async () => {
    const a = await cacheKey("what are his technical skills");
    const b = await cacheKey("what are his projects");
    const c = await cacheKey("what are his technical skills in python");
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("invalidates every entry when the notes are republished", async () => {
    const before = await cacheKey("tell me about jepa", "aaaaaaaaaaaa");
    const after = await cacheKey("tell me about jepa", "bbbbbbbbbbbb");
    expect(before).not.toBe(after);
  });

  it("produces a key that is safe to use as a KV name", async () => {
    const key = `answer:${await cacheKey("anything at all")}`;
    expect(key).toMatch(/^answer:[0-9a-f]{64}$/);
    // KV keys are capped at 512 bytes; a hash keeps us far under regardless
    // of how long a visitor's question is.
    const long = `answer:${await cacheKey("a".repeat(4000))}`;
    expect(long.length).toBeLessThan(512);
  });
});
