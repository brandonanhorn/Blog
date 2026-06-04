"use strict";

const Database = require("better-sqlite3");
const { DB_PATH } = require("./chatLog");
const http = require("http");

const HOST = "127.0.0.1";
const PORT = Number(process.env.ADMIN_PORT) || 8788;

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPage() {
  const db = new Database(DB_PATH, { readonly: true });
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN feedback = 'helpful' THEN 1 ELSE 0 END) AS helpful,
      SUM(CASE WHEN feedback = 'not_helpful' THEN 1 ELSE 0 END) AS not_helpful,
      SUM(CASE WHEN feedback IS NULL OR feedback = '' THEN 1 ELSE 0 END) AS no_feedback
    FROM chat_logs
  `).get();

  const rows = db.prepare(`
    SELECT id, created_at, question, answer, feedback, latency_ms, matched_sources, has_image, image_mime_type, image_size_bytes
    FROM chat_logs
    ORDER BY created_at DESC
    LIMIT 100
  `).all();
  db.close();

  const items = rows.map((row) => {
    const sources = row.matched_sources ? escapeHtml(row.matched_sources) : "";
    const imageMeta = row.has_image ? ` | image: ${escapeHtml(row.image_mime_type || "unknown")} (${escapeHtml(row.image_size_bytes || "n/a")} bytes)` : "";
    return `
      <article class="log">
        <div><strong>${escapeHtml(row.created_at)}</strong> | feedback: ${escapeHtml(row.feedback || "none")} | latency: ${escapeHtml(row.latency_ms || "n/a")}ms${imageMeta}</div>
        <div><strong>Question:</strong> ${escapeHtml(row.question)}</div>
        <details><summary><strong>Answer</strong></summary><pre>${escapeHtml(row.answer)}</pre></details>
        ${sources ? `<details><summary><strong>matched_sources</strong></summary><pre>${sources}</pre></details>` : ""}
      </article>
    `;
  }).join("\n");

  return `<!doctype html><html><head><meta charset="utf-8"><title>Local Chat Logs</title>
  <style>body{font-family:Arial,sans-serif;margin:20px;color:#000;background:#fff}.stats{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:16px}.card{border:1px solid #ccc;padding:8px 10px}.log{border:1px solid #ddd;padding:10px;margin:0 0 12px}pre{white-space:pre-wrap;word-break:break-word;background:#fafafa;padding:8px;border:1px solid #eee}</style>
  </head><body>
  <h1>Local Chat Logs</h1>
  <p>Bound to 127.0.0.1 only.</p>
  <div class="stats">
    <div class="card">Total logs: ${stats.total || 0}</div>
    <div class="card">Helpful: ${stats.helpful || 0}</div>
    <div class="card">Not helpful: ${stats.not_helpful || 0}</div>
    <div class="card">Unanswered / no feedback: ${stats.no_feedback || 0}</div>
  </div>
  ${items || "<p>No logs found.</p>"}
  </body></html>`;
}

http.createServer((_req, res) => {
  try {
    const html = renderPage();
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch (_error) {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Could not load logs.");
  }
}).listen(PORT, HOST, () => {
  console.log(`Local admin log viewer listening on http://${HOST}:${PORT}/`);
});
