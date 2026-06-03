"use strict";

require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { getRelevantContext } = require("./retrieval");
const { logChat, saveFeedback } = require("./chatLog");
const { callLocalModel, getModelConfig } = require("./localModel");

const app = express();

const PORT = Number(process.env.PORT) || 8787;
const FIXED_SYSTEM_PROMPT =
  "You are a helpful assistant. Use the provided context from Brandon's notes when it is relevant to the user's request. If relevant context is present, answer from it and do not claim you lack access. Never mention private files, local file paths, or system internals. You may summarize public-facing information from Brandon's notes. If the context is not relevant or insufficient, say what is missing clearly without inventing details.";
const FIXED_OPTIONS = {
  num_predict: 700,
  temperature: 0.2,
  top_p: 0.9
};

const defaultOrigins = [
  "https://brandonanhorn.com",
  "https://www.brandonanhorn.com",
  "http://localhost:4000",
  "http://127.0.0.1:4000"
];

const allowedOrigins = (process.env.ALLOWED_ORIGINS || defaultOrigins.join(","))
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set("trust proxy", 1);
app.use(helmet());
app.use(express.json({ limit: "16kb", type: "application/json" }));
app.use(rateLimit({ windowMs: 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false, message: { error: "Too many requests right now. Please try again in a minute." } }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Not allowed by CORS"));
  },
  methods: ["POST"],
  allowedHeaders: ["Content-Type"]
}));

function anonymizeIp(ip = "") {
  if (!ip) return "unknown";
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

function logRequest({ ip, inputLength, status, latencyMs }) {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), ip: anonymizeIp(ip), inputLength, status, latencyMs }));
}

app.use((req, res, next) => {
  if (req.method !== "POST") return next();
  if (!req.is("application/json")) {
    res.status(415).json({ error: "Requests must use application/json." });
    return;
  }
  next();
});

app.post("/api/chat", async (req, res) => {
  const startedAt = Date.now();
  const ip = req.ip;
  const body = req.body;
  const hasMessage = body && Object.prototype.hasOwnProperty.call(body, "message");

  if (!body || typeof body !== "object" || Array.isArray(body) || !hasMessage || Object.keys(body).length !== 1) {
    logRequest({ ip, inputLength: 0, status: 400, latencyMs: Date.now() - startedAt });
    return res.status(400).json({ error: "Invalid request. Send JSON with only a message field." });
  }

  const { message } = body;
  if (typeof message !== "string") {
    logRequest({ ip, inputLength: 0, status: 400, latencyMs: Date.now() - startedAt });
    return res.status(400).json({ error: "Message must be a string." });
  }

  const trimmedMessage = message.trim();
  if (!trimmedMessage) {
    logRequest({ ip, inputLength: 0, status: 400, latencyMs: Date.now() - startedAt });
    return res.status(400).json({ error: "Message cannot be empty." });
  }

  if (trimmedMessage.length > 4000) {
    logRequest({ ip, inputLength: trimmedMessage.length, status: 400, latencyMs: Date.now() - startedAt });
    return res.status(400).json({ error: "Message is too long. Max length is 4000 characters." });
  }

  let timeout;

  try {
    const modelConfig = getModelConfig(process.env);
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), modelConfig.timeoutMs);
    const relevantContext = getRelevantContext(trimmedMessage);
    const modelResult = await callLocalModel({
      messages: [{ role: "system", content: `${FIXED_SYSTEM_PROMPT}\n\nRelevant context from Brandon's notes:\n${relevantContext}` }, { role: "user", content: trimmedMessage }],
      options: FIXED_OPTIONS,
      env: process.env,
      signal: controller.signal
    });
    const responseMessage = modelResult.message;

    const latencyMs = Date.now() - startedAt;
    const matchedSources = Array.from(new Set(relevantContext.split("\n").filter((line) => line.startsWith("Source: ")).map((line) => line.slice(8).trim()).filter(Boolean)));

    const logId = logChat({ question: trimmedMessage, answer: responseMessage, model: modelResult.loggedModel, status: "success", latencyMs, matchedSources, userAgent: req.get("user-agent") || "", ip });
    logRequest({ ip, inputLength: trimmedMessage.length, status: 200, latencyMs });
    res.json({ message: responseMessage, logId });
  } catch (error) {
    console.error("[local-model] request failed", error.message);
    const statusCode = 502;
    logRequest({ ip, inputLength: trimmedMessage.length, status: statusCode, latencyMs: Date.now() - startedAt });
    res.status(statusCode).json({ error: "The knowledge interface is offline right now. Please try again later." });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
});

app.post("/api/feedback", (req, res) => {
  const { logId, feedback } = req.body || {};

  if (typeof logId !== "string" || !logId.trim()) {
    return res.status(400).json({ error: "Please provide a valid logId." });
  }

  if (feedback !== "helpful" && feedback !== "not_helpful") {
    return res.status(400).json({ error: "Feedback must be either helpful or not_helpful." });
  }

  const result = saveFeedback({ logId, feedback });
  if (result.ok) return res.json({ ok: true });
  if (result.code === "not_found") return res.status(404).json({ error: "Log entry not found." });
  if (result.code === "invalid_log_id") return res.status(400).json({ error: "Please provide a valid logId." });
  if (result.code === "invalid_feedback") return res.status(400).json({ error: "Feedback must be either helpful or not_helpful." });
  return res.status(500).json({ error: "Could not save feedback right now." });
});

app.use((error, _req, res, _next) => {
  if (error && error.message === "Not allowed by CORS") return res.status(403).json({ error: "This origin is not allowed." });
  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, "127.0.0.1", () => {
  try {
    const modelConfig = getModelConfig(process.env);
    console.log(`Knowledge proxy listening on http://127.0.0.1:${PORT} using ${modelConfig.loggedModel}`);
  } catch (error) {
    console.error("Knowledge proxy listening with invalid model backend config", error.message);
  }
});
