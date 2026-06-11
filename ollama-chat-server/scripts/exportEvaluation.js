"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const SERVER_ROOT = path.join(__dirname, "..");
const DB_PATH = path.join(SERVER_ROOT, "data", "chat_logs.sqlite");
const EXPORT_DIR = path.join(SERVER_ROOT, "exports");

const EVALUATION_PATH = path.join(EXPORT_DIR, "evaluation_dataset.jsonl");
const GOLDEN_QUESTIONS_PATH = path.join(EXPORT_DIR, "golden_questions.jsonl");

const CATEGORY_ORDER = ["career", "projects", "ai", "writing", "personal_knowledge", "other"];

const CATEGORY_RULES = [
  { category: "career", keywords: ["career", "resume", "work", "job", "hiring", "recruiter", "experience"] },
  { category: "projects", keywords: ["project", "built", "building", "app", "website", "bot", "system"] },
  { category: "ai", keywords: ["ai", "llm", "model", "ollama", "gemma", "hermes", "rag", "embeddings"] },
  { category: "writing", keywords: ["write", "writing", "blog", "post", "essay", "idea"] },
  { category: "personal_knowledge", keywords: ["notes", "obsidian", "second brain", "knowledge", "wiki"] }
];

const EVALUATION_GUIDANCE = {
  must_be_grounded_in_notes: true,
  should_answer_directly: true,
  should_not_claim_no_access_if_context_exists: true,
  style: "Clear, grounded, concise, and written in Brandon's voice where appropriate."
};

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

function normalizeQuestion(question) {
  return String(question)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[.!?;:,]+$/g, "")
    .trim();
}

function inferCategory(question) {
  const normalizedQuestion = ` ${String(question).toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()} `;

  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => normalizedQuestion.includes(` ${keyword} `))) {
      return rule.category;
    }
  }

  return "other";
}

function buildMetadata(row, columns) {
  return {
    latency_ms: columns.has("latency_ms") ? selectValue(row, "latency_ms") : null,
    has_image: columns.has("has_image") ? toBoolean(selectValue(row, "has_image", false)) : false,
    has_audio: columns.has("has_audio") ? toBoolean(selectValue(row, "has_audio", false)) : false
  };
}

function buildEvaluationRecord(row, columns) {
  const fallbackId = `chat_log_${selectValue(row, "__rowid")}`;
  const id = selectValue(row, "id", fallbackId) ?? fallbackId;

  return {
    id,
    created_at: selectValue(row, "created_at"),
    category: inferCategory(selectValue(row, "question", "")),
    question: selectValue(row, "question"),
    reference_answer: selectValue(row, "answer"),
    model: selectValue(row, "model"),
    matched_sources: columns.has("matched_sources") ? parseMatchedSources(selectValue(row, "matched_sources")) : null,
    evaluation_guidance: EVALUATION_GUIDANCE,
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
    "has_audio"
  ].filter((column) => columns.has(column));

  const whereClauses = [
    "COALESCE(TRIM(question), '') <> ''",
    "COALESCE(TRIM(answer), '') <> ''",
    "feedback = 'helpful'"
  ];

  if (columns.has("status")) {
    whereClauses.unshift("status = 'success'");
  }

  const orderBy = columns.has("created_at") ? "created_at ASC" : columns.has("id") ? "id ASC" : "rowid ASC";

  return {
    sql: `
      SELECT rowid AS __rowid, ${selectColumns.map(quoteIdentifier).join(", ")}
      FROM chat_logs
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY ${orderBy}
    `,
    missingRequiredColumns: []
  };
}

function dedupeByQuestion(rows) {
  const seenQuestions = new Set();
  const dedupedRows = [];

  for (const row of rows) {
    const normalizedQuestion = normalizeQuestion(row.question);

    if (!normalizedQuestion || seenQuestions.has(normalizedQuestion)) {
      continue;
    }

    seenQuestions.add(normalizedQuestion);
    dedupedRows.push(row);
  }

  return dedupedRows;
}

function buildGoldenQuestions(evaluationRecords) {
  const recordsByCategory = new Map(CATEGORY_ORDER.map((category) => [category, []]));

  evaluationRecords.forEach((record, index) => {
    recordsByCategory.get(record.category).push({ record, index });
  });

  const selected = [];
  const selectedIds = new Set();
  const categoryOffsets = new Map(CATEGORY_ORDER.map((category) => [category, 0]));

  function selectCandidate(candidate) {
    selected.push(candidate);
    selectedIds.add(candidate.record.id);
  }

  for (const category of CATEGORY_ORDER) {
    const categoryRecords = recordsByCategory.get(category);
    if (categoryRecords.length && selected.length < 25) {
      selectCandidate(categoryRecords[0]);
      categoryOffsets.set(category, 1);
    }
  }

  while (selected.length < 25) {
    let addedThisRound = false;

    for (const category of CATEGORY_ORDER) {
      const categoryRecords = recordsByCategory.get(category);
      const offset = categoryOffsets.get(category);
      const candidate = categoryRecords[offset];

      if (candidate && !selectedIds.has(candidate.record.id)) {
        selectCandidate(candidate);
        addedThisRound = true;
      }

      categoryOffsets.set(category, offset + 1);

      if (selected.length >= 25) {
        break;
      }
    }

    if (!addedThisRound) {
      break;
    }
  }

  return selected.sort((a, b) => a.index - b.index).map((candidate) => candidate.record);
}

function countCategories(records) {
  const counts = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0]));

  for (const record of records) {
    counts[record.category] += 1;
  }

  return counts;
}

function main() {
  if (!fs.existsSync(DB_PATH)) {
    exitWithMessage(`Evaluation export could not find the SQLite database at ${DB_PATH}. Run the local chat server and collect helpful feedback before exporting.`);
    return;
  }

  let db;
  try {
    db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
  } catch (error) {
    exitWithMessage(`Evaluation export could not open the SQLite database in read-only mode: ${error.message}`);
    return;
  }

  try {
    const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'chat_logs'").get();
    if (!tableExists) {
      exitWithMessage("Evaluation export could not find a chat_logs table in the SQLite database.");
      return;
    }

    const columns = getColumnNames(db);
    const { sql, missingRequiredColumns } = buildQuery(columns);

    if (missingRequiredColumns.length) {
      exitWithMessage(`Evaluation export could not run because chat_logs is missing required column(s): ${missingRequiredColumns.join(", ")}.`);
      return;
    }

    const rows = dedupeByQuestion(db.prepare(sql).all());
    const evaluationRecords = rows.map((row) => buildEvaluationRecord(row, columns));
    const goldenQuestionRecords = buildGoldenQuestions(evaluationRecords);
    const categoryCounts = countCategories(evaluationRecords);

    fs.mkdirSync(EXPORT_DIR, { recursive: true });
    writeJsonl(EVALUATION_PATH, evaluationRecords);
    writeJsonl(GOLDEN_QUESTIONS_PATH, goldenQuestionRecords);

    console.log("Evaluation export complete.");
    console.log(`Evaluation records: ${evaluationRecords.length}`);
    console.log(`Golden questions: ${goldenQuestionRecords.length}`);
    console.log("Categories:");
    for (const category of CATEGORY_ORDER) {
      console.log(`* ${category}: ${categoryCounts[category]}`);
    }
    console.log(`Output directory: ${EXPORT_DIR}`);
  } catch (error) {
    exitWithMessage(`Evaluation export failed: ${error.message}`);
  } finally {
    if (db) {
      db.close();
    }
  }
}

main();
