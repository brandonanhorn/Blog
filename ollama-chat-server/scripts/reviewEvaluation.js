"use strict";

const fs = require("fs");
const path = require("path");

const SERVER_ROOT = path.join(__dirname, "..");
const MODEL_RUNS_DIR = path.join(SERVER_ROOT, "exports", "model_runs");
const REVIEWS_DIR = path.join(SERVER_ROOT, "exports", "reviews");

const CSV_COLUMNS = [
  "run_id",
  "id",
  "created_at",
  "category",
  "question",
  "reference_answer",
  "model_answer",
  "model",
  "status",
  "latency_ms",
  "matched_sources",
  "score",
  "verdict",
  "notes"
];

function exitWithMessage(message) {
  console.error(message);
  process.exitCode = 1;
}

function findLatestModelRun() {
  if (!fs.existsSync(MODEL_RUNS_DIR)) return null;

  const candidates = fs.readdirSync(MODEL_RUNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^run_.*\.jsonl$/.test(entry.name))
    .map((entry) => {
      const filePath = path.join(MODEL_RUNS_DIR, entry.name);
      const stat = fs.statSync(filePath);
      return { filePath, name: entry.name, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));

  return candidates[0] || null;
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`);
      }
    });
}

function stringifyMatchedSources(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value) || typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvValue(value) {
  if (value === undefined || value === null) return "";

  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

function safeOutputRunId(runId) {
  return String(runId || "unknown_run")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "unknown_run";
}

function buildReviewRow(record, fallbackRunId) {
  return {
    run_id: record.run_id || fallbackRunId,
    id: record.id || "",
    created_at: record.created_at || "",
    category: record.category || "",
    question: record.question || "",
    reference_answer: record.reference_answer || "",
    model_answer: record.model_answer || "",
    model: record.model || "",
    status: record.status || "",
    latency_ms: record.latency_ms ?? "",
    matched_sources: stringifyMatchedSources(record.matched_sources),
    score: "",
    verdict: "",
    notes: ""
  };
}

function toCsv(rows) {
  const header = CSV_COLUMNS.join(",");
  const lines = rows.map((row) => CSV_COLUMNS.map((column) => csvValue(row[column])).join(","));
  return `${[header, ...lines].join("\n")}\n`;
}

function runIdFromFilename(fileName) {
  return fileName.replace(/^run_/, "").replace(/\.jsonl$/, "");
}

function main() {
  const latestRun = findLatestModelRun();
  if (!latestRun) {
    exitWithMessage("Missing model run. Run npm run eval:model first.");
    return;
  }

  let records;
  try {
    records = readJsonl(latestRun.filePath);
  } catch (error) {
    exitWithMessage(`Could not read model run: ${error.message}`);
    return;
  }

  const fallbackRunId = runIdFromFilename(latestRun.name);
  const runId = records.find((record) => record && record.run_id)?.run_id || fallbackRunId;
  const outputPath = path.join(REVIEWS_DIR, `review_${safeOutputRunId(runId)}.csv`);
  const reviewRows = records.map((record) => buildReviewRow(record || {}, runId));

  fs.mkdirSync(REVIEWS_DIR, { recursive: true });
  fs.writeFileSync(outputPath, toCsv(reviewRows), "utf8");

  console.log("Review sheet created.");
  console.log(`Input run: ${latestRun.filePath}`);
  console.log(`Rows: ${reviewRows.length}`);
  console.log(`Output: ${outputPath}`);
}

main();
