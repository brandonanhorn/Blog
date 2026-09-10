-- D1 schema for chat logs and feedback.
--
-- Carried over from ollama-chat-server/src/chatLog.js unchanged, so the export
-- and eval scripts in that folder keep working once they read from D1 instead
-- of the local SQLite file:
--
--   wrangler d1 execute knowledge-logs --remote --json \
--     --command "SELECT * FROM chat_logs WHERE feedback IS NOT NULL"
--
-- Questions and answers are stored in full; user agent and IP are stored only
-- as SHA-256 hashes, never in the clear.

CREATE TABLE IF NOT EXISTS chat_logs (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL,
  question            TEXT NOT NULL,
  answer              TEXT NOT NULL,
  question_length     INTEGER NOT NULL,
  answer_length       INTEGER NOT NULL,
  model               TEXT NOT NULL,
  status              TEXT NOT NULL,
  latency_ms          INTEGER,
  matched_sources     TEXT,
  user_agent_hash     TEXT,
  ip_hash             TEXT,
  has_image           INTEGER DEFAULT 0,
  image_mime_type     TEXT,
  image_size_bytes    INTEGER,
  feedback            TEXT,
  feedback_created_at TEXT
);

CREATE INDEX IF NOT EXISTS chat_logs_created_at ON chat_logs (created_at);
CREATE INDEX IF NOT EXISTS chat_logs_feedback ON chat_logs (feedback);
