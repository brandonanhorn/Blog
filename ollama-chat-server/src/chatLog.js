"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "chat_logs.sqlite");

const ALLOWED_FEEDBACK = new Set(["helpful", "not_helpful"]);

let db = null;
let insertLog = null;
let updateFeedbackStatement = null;
let hasFeedbackColumn = false;

function safeHash(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  try {
    return crypto.createHash("sha256").update(value).digest("hex");
  } catch (_error) {
    return null;
  }
}

function columnExists(columnName) {
  const columns = db.prepare("PRAGMA table_info(chat_logs)").all();
  return columns.some((column) => column && column.name === columnName);
}

function initializeDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS chat_logs (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        question TEXT NOT NULL,
        answer TEXT NOT NULL,
        question_length INTEGER NOT NULL,
        answer_length INTEGER NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        latency_ms INTEGER,
        matched_sources TEXT,
        user_agent_hash TEXT,
        ip_hash TEXT
      );
    `);

    if (!columnExists("has_image")) {
      db.exec("ALTER TABLE chat_logs ADD COLUMN has_image INTEGER DEFAULT 0");
    }

    if (!columnExists("image_mime_type")) {
      db.exec("ALTER TABLE chat_logs ADD COLUMN image_mime_type TEXT");
    }

    if (!columnExists("image_size_bytes")) {
      db.exec("ALTER TABLE chat_logs ADD COLUMN image_size_bytes INTEGER");
    }

    if (!columnExists("feedback")) {
      db.exec("ALTER TABLE chat_logs ADD COLUMN feedback TEXT");
    }

    if (!columnExists("feedback_created_at")) {
      db.exec("ALTER TABLE chat_logs ADD COLUMN feedback_created_at TEXT");
    }

    hasFeedbackColumn = columnExists("feedback") && columnExists("feedback_created_at");

    insertLog = db.prepare(`
      INSERT INTO chat_logs (
        id,
        created_at,
        question,
        answer,
        question_length,
        answer_length,
        model,
        status,
        latency_ms,
        matched_sources,
        user_agent_hash,
        ip_hash,
        has_image,
        image_mime_type,
        image_size_bytes
      ) VALUES (
        @id,
        @createdAt,
        @question,
        @answer,
        @questionLength,
        @answerLength,
        @model,
        @status,
        @latencyMs,
        @matchedSources,
        @userAgentHash,
        @ipHash,
        @hasImage,
        @imageMimeType,
        @imageSizeBytes
      )
    `);

    updateFeedbackStatement = db.prepare(`
      UPDATE chat_logs
      SET feedback = @feedback,
          feedback_created_at = @feedbackCreatedAt
      WHERE id = @id
    `);
  } catch (error) {
    console.error("[chat-log] init failed", error.message);
  }
}

function logChat({ question, answer, model, status, latencyMs, matchedSources, userAgent, ip, hasImage = false, imageMimeType = null, imageSizeBytes = null }) {
  if (!insertLog) {
    return null;
  }

  try {
    const id = crypto.randomUUID();

    insertLog.run({
      id,
      createdAt: new Date().toISOString(),
      question: String(question || ""),
      answer: String(answer || ""),
      questionLength: String(question || "").length,
      answerLength: String(answer || "").length,
      model: String(model || "unknown"),
      status: String(status || "unknown"),
      latencyMs: Number.isFinite(latencyMs) ? Math.round(latencyMs) : null,
      matchedSources: Array.isArray(matchedSources) && matchedSources.length ? JSON.stringify(matchedSources) : null,
      userAgentHash: safeHash(userAgent),
      ipHash: safeHash(ip),
      hasImage: hasImage ? 1 : 0,
      imageMimeType: imageMimeType ? String(imageMimeType) : null,
      imageSizeBytes: Number.isFinite(imageSizeBytes) ? Math.round(imageSizeBytes) : null
    });

    return id;
  } catch (error) {
    console.error("[chat-log] write failed", error.message);
    return null;
  }
}

function saveFeedback({ logId, feedback }) {
  if (!db || !updateFeedbackStatement || !hasFeedbackColumn) {
    return { ok: false, code: "unavailable" };
  }

  if (typeof logId !== "string" || !logId.trim()) {
    return { ok: false, code: "invalid_log_id" };
  }

  if (!ALLOWED_FEEDBACK.has(feedback)) {
    return { ok: false, code: "invalid_feedback" };
  }

  try {
    const result = updateFeedbackStatement.run({
      id: logId.trim(),
      feedback,
      feedbackCreatedAt: new Date().toISOString()
    });

    if (!result.changes) {
      return { ok: false, code: "not_found" };
    }

    return { ok: true };
  } catch (_error) {
    return { ok: false, code: "db_error" };
  }
}

initializeDb();

module.exports = {
  logChat,
  saveFeedback,
  DB_PATH
};
