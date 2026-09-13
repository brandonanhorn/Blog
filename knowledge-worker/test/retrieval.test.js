import { describe, expect, it } from "vitest";
import {
  getRelevantContext,
  INDEX_SIZE,
  INDEX_VERSION,
  MAX_CONTEXT_CHARS
} from "../src/retrieval.js";

// The scoring here is a straight port from ollama-chat-server. These tests
// check that the port still finds the right notes, and — more importantly for
// the budget — that it can never return more context than the gate's estimate
// assumed.

describe("the bundled index", () => {
  it("has content and a version", () => {
    expect(INDEX_SIZE).toBeGreaterThan(0);
    expect(INDEX_VERSION).toMatch(/^[0-9a-f]{12}$/);
  });
});

describe("finding the right note", () => {
  it("answers a skills question from the skills note", () => {
    const { sources } = getRelevantContext("what are Brandon's technical skills?");
    expect(sources.join(" ")).toContain("technical_skills");
  });

  it("answers a project question from that project's note", () => {
    const { sources } = getRelevantContext("tell me about the JEPA project");
    expect(sources.join(" ")).toContain("jepa");
  });

  it("routes a hiring question via the career synonyms", () => {
    // "career" expands to experience/work/job/professional/background/resume,
    // which is what gets a recruiter's phrasing to the resume note.
    const { sources, context } = getRelevantContext("is he a good hire? what is his career like");
    expect(context.length).toBeGreaterThan(0);
    expect(sources.join(" ")).toMatch(/life\//);
  });
});

describe("bounds the budget depends on", () => {
  it("never exceeds the context ceiling", () => {
    const queries = [
      "brandon experience work project skills python machine learning notes writing career",
      "second brain diffusion gemma jepa resume technical skills website local models",
      "a".repeat(4000)
    ];

    for (const query of queries) {
      const { context } = getRelevantContext(query);
      expect(context.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    }
  });

  it("returns nothing for an empty or unmatchable question", () => {
    expect(getRelevantContext("").context).toBe("");
    expect(getRelevantContext("   ").context).toBe("");
    expect(getRelevantContext("!!!???").context).toBe("");
  });

  it("returns at most four sources", () => {
    const { sources } = getRelevantContext("brandon project work notes skills experience");
    expect(sources.length).toBeLessThanOrEqual(4);
  });
});

describe("context is never silently empty", () => {
  // Regression: MAX_CONTEXT_CHARS (5200) was smaller than the indexer's
  // whole-note cap (6000), and the assembly loop broke instead of skipping. A
  // note between those sizes ranking first returned NO context, so the bot
  // answered "I don't have that information" for its best match.
  const realQuestions = [
    "what are your hobbies",
    "what are your technical skills",
    "how do you know your classifier is accurate",
    "what do you want in your next role",
    "what is guulfai",
    "tell me about voice of client",
    "does he have security clearance",
    "how do you mentor your direct reports",
    "when would you not use an LLM",
    "what business impact have you had"
  ];

  for (const q of realQuestions) {
    it(`"${q}" returns usable context`, () => {
      const { context, sources } = getRelevantContext(q);
      expect(sources.length).toBeGreaterThan(0);
      expect(context.length).toBeGreaterThan(0);
      expect(context.length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS);
    });
  }

  it("every whole-note candidate fits the context budget", async () => {
    const index = (await import("../src/index.json")).default;
    const tooBig = index.candidates
      .filter((c) => c.kind === "full-note")
      .filter((c) => c.text.length + c.filePath.length + 20 > MAX_CONTEXT_CHARS)
      .map((c) => c.filePath);
    expect(tooBig).toEqual([]);
  });
});
