"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const DATA_DIR = path.join(__dirname, "..", "data");
const DB_PATH = path.join(DATA_DIR, "chat_logs.sqlite");

let insertLog = null;

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

function initializeDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }

    const db = new Database(DB_PATH);
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
        ip_hash
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
        @ipHash
      )
    `);
  } catch (error) {
    console.error("[chat-log] init failed", error.message);
  }
}

function logChat({ question, answer, model, status, latencyMs, matchedSources, userAgent, ip }) {
  if (!insertLog) {
    return;
  }

  try {
    insertLog.run({
      id: crypto.randomUUID(),
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
      ipHash: safeHash(ip)
    });
  } catch (error) {
    console.error("[chat-log] write failed", error.message);
  }
}

initializeDb();

module.exports = {
  logChat
};
