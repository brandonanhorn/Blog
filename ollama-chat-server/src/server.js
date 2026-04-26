"use strict";

require("dotenv").config();

const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { getRelevantContext } = require("./retrieval");

const app = express();

const PORT = Number(process.env.PORT) || 8787;
const OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const FIXED_MODEL = "hermes31-8b-q4";
const FIXED_SYSTEM_PROMPT =
  "You do not have access to private files, databases, admin tools, secrets, logs, environment variables, local file paths, or hidden system information. If you do not know something, say so clearly. Do not claim access to information you cannot see.\n\nAct as a helpful assistant";
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

app.set("trust proxy", true);
app.use(helmet());
app.use(express.json({ limit: "16kb", type: "application/json" }));

app.use(
  rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests right now. Please try again in a minute." }
  })
);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error("Not allowed by CORS"));
    },
    methods: ["POST"],
    allowedHeaders: ["Content-Type"]
  })
);

function anonymizeIp(ip = "") {
  if (!ip) {
    return "unknown";
  }

  if (ip.includes(".")) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }

  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 12);
}

function logRequest({ ip, inputLength, status, latencyMs }) {
  const payload = {
    timestamp: new Date().toISOString(),
    ip: anonymizeIp(ip),
    inputLength,
    status,
    latencyMs
  };

  console.log(JSON.stringify(payload));
}

app.use((req, res, next) => {
  if (req.method !== "POST") {
    next();
    return;
  }

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
    res.status(400).json({ error: "Invalid request. Send JSON with only a message field." });
    return;
  }

  const { message } = body;

  if (typeof message !== "string") {
    logRequest({ ip, inputLength: 0, status: 400, latencyMs: Date.now() - startedAt });
    res.status(400).json({ error: "Message must be a string." });
    return;
  }

  const trimmedMessage = message.trim();

  if (!trimmedMessage) {
    logRequest({ ip, inputLength: 0, status: 400, latencyMs: Date.now() - startedAt });
    res.status(400).json({ error: "Message cannot be empty." });
    return;
  }

  if (trimmedMessage.length > 4000) {
    logRequest({ ip, inputLength: trimmedMessage.length, status: 400, latencyMs: Date.now() - startedAt });
    res.status(400).json({ error: "Message is too long. Max length is 4000 characters." });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const ollamaResponse = await fetch(OLLAMA_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: FIXED_MODEL,
        stream: false,
        messages: [
          {
            role: "system",
            content:
              FIXED_SYSTEM_PROMPT +
              "\n\nRelevant context from Brandon's notes:\n" +
              getRelevantContext(trimmedMessage)
          },
          {
            role: "user",
            content: trimmedMessage
          }
        ],
        options: FIXED_OPTIONS
      }),
      signal: controller.signal
    });

    if (!ollamaResponse.ok) {
      throw new Error(`ollama_http_${ollamaResponse.status}`);
    }

    const data = await ollamaResponse.json();
    const responseMessage =
      typeof data?.message?.content === "string" ? data.message.content.trim() : "";

    if (!responseMessage) {
      throw new Error("empty_model_response");
    }

    logRequest({
      ip,
      inputLength: trimmedMessage.length,
      status: 200,
      latencyMs: Date.now() - startedAt
    });

    res.json({ message: responseMessage });
  } catch (_error) {
    const statusCode = 502;

    logRequest({
      ip,
      inputLength: trimmedMessage.length,
      status: statusCode,
      latencyMs: Date.now() - startedAt
    });

    res.status(statusCode).json({
      error: "The knowledge interface is offline right now. Please try again later."
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.use((error, _req, res, _next) => {
  if (error && error.message === "Not allowed by CORS") {
    res.status(403).json({ error: "This origin is not allowed." });
    return;
  }

  res.status(500).json({ error: "Unexpected server error." });
});

app.listen(PORT, () => {
  console.log(`Ollama proxy listening on http://127.0.0.1:${PORT}`);
});
