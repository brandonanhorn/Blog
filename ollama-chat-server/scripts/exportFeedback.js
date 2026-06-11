"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const SERVER_ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(SERVER_ROOT, "data", "chat_logs.sqlite");
const EXPORT_DIR = path.join(SERVER_ROOT, "exports");

const HELPFUL_PATH = path.join(EXPORT_DIR, "helpful_answers.jsonl");
const NOT_HELPFUL_PATH = path.join(EXPORT_DIR, "not_helpful_answers.jsonl");
const PREFERENCE_PATH = path.join(EXPORT_DIR, "preference_dataset.jsonl");

const FEEDBACK_VALUES = new Set(["helpful", "not_helpful"]);

function exitWithMessage(message) {
  console.error(message);
  process.exitCode = 1;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function getColumnNames(db) {
  return new Set(db.prepare("PRAGMA table_info(chat_logs)").all().map((column) => column.name));
}

function selectValue(row, columnName, fallback = null) {
  return Object.prototype.hasOwnProperty.call(row, columnName) ? row[columnName] : fallback;
}

function parseMatchedSources(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return value;
  }
}

function toBoolean(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function buildMetadata(row, columns) {
  return {
    has_image: columns.has("has_image") ? toBoolean(selectValue(row, "has_image", false)) : false,
    image_mime_type: columns.has("image_mime_type") ? selectValue(row, "image_mime_type") : null,
    image_size_bytes: columns.has("image_size_bytes") ? selectValue(row, "image_size_bytes") : null,
    has_audio: columns.has("has_audio") ? toBoolean(selectValue(row, "has_audio", false)) : false,
    audio_mime_type: columns.has("audio_mime_type") ? selectValue(row, "audio_mime_type") : null,
    audio_size_bytes: columns.has("audio_size_bytes") ? selectValue(row, "audio_size_bytes") : null
  };
}

function buildAnswerRecord(row, columns) {
  return {
    id: selectValue(row, "id"),
    created_at: selectValue(row, "created_at"),
    model: selectValue(row, "model"),
    question: selectValue(row, "question"),
    answer: selectValue(row, "answer"),
    feedback: selectValue(row, "feedback"),
    matched_sources: columns.has("matched_sources") ? parseMatchedSources(selectValue(row, "matched_sources")) : null,
    latency_ms: columns.has("latency_ms") ? selectValue(row, "latency_ms") : null,
    metadata: buildMetadata(row, columns)
  };
}

function buildPreferenceRecord(row, columns) {
  const feedback = selectValue(row, "feedback");
  const answer = selectValue(row, "answer");

  return {
    id: selectValue(row, "id"),
    prompt: selectValue(row, "question"),
    chosen: feedback === "helpful" ? answer : null,
    rejected: feedback === "not_helpful" ? answer : null,
    feedback,
    model: selectValue(row, "model"),
    created_at: selectValue(row, "created_at"),
    matched_sources: columns.has("matched_sources") ? parseMatchedSources(selectValue(row, "matched_sources")) : null,
    metadata: buildMetadata(row, columns)
  };
}

function writeJsonl(filePath, records) {
  const content = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(filePath, content ? `${content}\n` : "", "utf8");
}

function buildQuery(columns) {
  const requiredColumns = ["question", "answer", "feedback"];
  const missingRequiredColumns = requiredColumns.filter((column) => !columns.has(column));

  if (missingRequiredColumns.length) {
    return { sql: null, missingRequiredColumns };
  }

  const selectColumns = [
    "id",
    "created_at",
    "model",
    "question",
    "answer",
    "feedback",
    "matched_sources",
    "latency_ms",
    "has_image",
    "image_mime_type",
    "image_size_bytes",
    "has_audio",
    "audio_mime_type",
    "audio_size_bytes"
  ].filter((column) => columns.has(column));

  const whereClauses = [
    "COALESCE(TRIM(question), '') <> ''",
    "COALESCE(TRIM(answer), '') <> ''",
    "feedback IN ('helpful', 'not_helpful')"
  ];

  if (columns.has("status")) {
    whereClauses.unshift("status = 'success'");
  }

  const orderBy = columns.has("created_at") ? "created_at ASC" : columns.has("id") ? "id ASC" : "rowid ASC";

  return {
    sql: `
      SELECT ${selectColumns.map(quoteIdentifier).join(", ")}
      FROM chat_logs
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY ${orderBy}
    `,
    missingRequiredColumns: []
  };
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    exitWithMessage(`Feedback export could not find the SQLite database at ${DB_PATH}. Run the local chat server and collect feedback before exporting.`);
    return;
  }

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch (error) {
    exitWithMessage(`Feedback export could not open the SQLite database in read-only mode: ${error.message}`);
    return;
  }

  try {
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_logs'").get();
    if (!tableExists) {
      exitWithMessage("Feedback export could not find a chat_logs table in the SQLite database.");
      return;
    }

    const columns = getColumnNames(db);
    const { sql, missingRequiredColumns } = buildQuery(columns);

    if (missingRequiredColumns.length) {
      exitWithMessage(`Feedback export could not run because chat_logs is missing required column(s): ${missingRequiredColumns.join(", ")}.`);
      return;
    }

    const rows = db.prepare(sql).all().filter((row) => FEEDBACK_VALUES.has(row.feedback));
    const helpfulRows = rows.filter((row) => row.feedback === "helpful");
    const notHelpfulRows = rows.filter((row) => row.feedback === "not_helpful");

    const helpfulRecords = helpfulRows.map((row) => buildAnswerRecord(row, columns));
    const notHelpfulRecords = notHelpfulRows.map((row) => buildAnswerRecord(row, columns));
    const preferenceRecords = rows.map((row) => buildPreferenceRecord(row, columns));

    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    writeJsonl(HELPFUL_PATH, helpfulRecords);
    writeJsonl(NOT_HELPFUL_PATH, notHelpfulRecords);
    writeJsonl(PREFERENCE_PATH, preferenceRecords);

    console.log("Feedback export complete.");
    console.log(`Helpful rows: ${helpfulRecords.length}`);
    console.log(`Not helpful rows: ${notHelpfulRecords.length}`);
    console.log(`Preference records: ${preferenceRecords.length}`);
    console.log(`Output directory: ${EXPORT_DIR}`);
  } catch (error) {
    exitWithMessage(`Feedback export failed: ${error.message}`);
  } finally {
    if (db) {
      db.close();
    }
  }
}

main();
