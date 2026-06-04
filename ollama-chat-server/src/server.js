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
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

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
  if (req.path === "/api/chat-multimodal") return next();
  if (!req.is("application/json")) {
    res.status(415).json({ error: "Requests must use application/json." });
    return;
  }
  next();
});

function extractMatchedSources(relevantContext) {
  return Array.from(new Set(relevantContext.split("\n").filter((line) => line.startsWith("Source: ")).map((line) => line.slice(8).trim()).filter(Boolean)));
}

async function answerKnowledgeQuestion({ message, image, env, signal }) {
  const relevantContext = getRelevantContext(message);
  const systemContent = `${FIXED_SYSTEM_PROMPT}\n\nRelevant context from Brandon's notes:\n${relevantContext}`;
  const userContent = image
    ? [
        { type: "text", text: `${message}. Answer directly without explaining your reasoning.` },
        { type: "image_url", image_url: { url: image.dataUrl } }
      ]
    : message;
  const modelResult = await callLocalModel({
    messages: [{ role: "system", content: systemContent }, { role: "user", content: userContent }],
    options: FIXED_OPTIONS,
    env,
    signal
  });

  return { modelResult, matchedSources: extractMatchedSources(relevantContext) };
}

function validateMessageField(value) {
  if (typeof value !== "string") {
    return { error: "Message must be a string." };
  }

  const trimmedMessage = value.trim();
  if (!trimmedMessage) {
    return { error: "Message cannot be empty.", inputLength: 0 };
  }

  if (trimmedMessage.length > 4000) {
    return { error: "Message is too long. Max length is 4000 characters.", inputLength: trimmedMessage.length };
  }

  return { trimmedMessage, inputLength: trimmedMessage.length };
}

function parseContentDisposition(value = "") {
  const parsed = {};
  value.split(";").slice(1).forEach((item) => {
    const [rawKey, ...rawValue] = item.trim().split("=");
    if (!rawKey || !rawValue.length) return;
    parsed[rawKey.toLowerCase()] = rawValue.join("=").trim().replace(/^"|"$/g, "");
  });
  return parsed;
}

function parseBoundary(contentType = "") {
  const match = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  return match ? (match[1] || match[2] || "").trim() : "";
}

function parseMultipartBuffer(body, boundary) {
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");
  const nextBoundaryPrefix = Buffer.from(`\r\n--${boundary}`);
  const result = { fields: {}, file: null };
  let position = body.indexOf(boundaryBuffer);

  if (position === -1) {
    throw new Error("invalid_multipart_body");
  }

  while (position !== -1) {
    position += boundaryBuffer.length;

    if (body.slice(position, position + 2).toString() === "--") break;
    if (body.slice(position, position + 2).toString() === "\r\n") position += 2;

    const headersEnd = body.indexOf(headerSeparator, position);
    if (headersEnd === -1) break;

    const rawHeaders = body.slice(position, headersEnd).toString("utf8");
    const headers = {};
    rawHeaders.split("\r\n").forEach((line) => {
      const separatorIndex = line.indexOf(":");
      if (separatorIndex === -1) return;
      headers[line.slice(0, separatorIndex).trim().toLowerCase()] = line.slice(separatorIndex + 1).trim();
    });

    const dataStart = headersEnd + headerSeparator.length;
    const nextBoundary = body.indexOf(nextBoundaryPrefix, dataStart);
    if (nextBoundary === -1) break;

    const data = body.slice(dataStart, nextBoundary);
    const disposition = parseContentDisposition(headers["content-disposition"]);
    const fieldName = disposition.name;
    const filename = disposition.filename;

    if (filename !== undefined) {
      if (fieldName !== "image") {
        throw new Error("unexpected_file_field");
      }
      if (result.file) {
        throw new Error("too_many_images");
      }
      if (data.length) {
        result.file = {
          originalname: filename,
          mimetype: headers["content-type"] || "application/octet-stream",
          size: data.length,
          buffer: data
        };
      }
    } else if (fieldName) {
      result.fields[fieldName] = data.toString("utf8");
    }

    position = nextBoundary + 2;
  }

  return result;
}

const readMultipartBody = express.raw({ type: "multipart/form-data", limit: "6mb" });

function parseMultipartUpload(req, res, next) {
  if (!req.is("multipart/form-data")) {
    res.status(415).json({ error: "Multimodal requests must use multipart/form-data." });
    return;
  }

  readMultipartBody(req, res, (error) => {
    if (error) {
      res.status(400).json({ error: "Image is too large. Please attach a PNG, JPEG, or WebP image up to 5 MB." });
      return;
    }

    try {
      const boundary = parseBoundary(req.get("content-type") || "");
      if (!boundary || !Buffer.isBuffer(req.body)) {
        res.status(400).json({ error: "Invalid multipart upload. Please send a message and an optional image." });
        return;
      }

      const parsed = parseMultipartBuffer(req.body, boundary);
      const image = parsed.file;

      if (image) {
        if (!ALLOWED_IMAGE_MIME_TYPES.has(image.mimetype)) {
          res.status(400).json({ error: "Unsupported image type. Please attach a PNG, JPEG, or WebP image." });
          return;
        }

        if (image.size > MAX_IMAGE_SIZE_BYTES) {
          res.status(400).json({ error: "Image is too large. Please attach a PNG, JPEG, or WebP image up to 5 MB." });
          return;
        }
      }

      req.body = parsed.fields;
      req.file = image || null;
      next();
    } catch (parseError) {
      if (parseError.message === "unexpected_file_field" || parseError.message === "too_many_images") {
        res.status(400).json({ error: "Please attach only one image using the image field." });
        return;
      }

      res.status(400).json({ error: "Invalid multipart upload. Please send a message and an optional image." });
    }
  });
}

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
    const { modelResult, matchedSources } = await answerKnowledgeQuestion({
      message: trimmedMessage,
      env: process.env,
      signal: controller.signal
    });
    const responseMessage = modelResult.message;

    const latencyMs = Date.now() - startedAt;

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

app.post("/api/chat-multimodal", parseMultipartUpload, async (req, res) => {
  const startedAt = Date.now();
  const ip = req.ip;
  const messageValidation = validateMessageField(req.body?.message);

  if (messageValidation.error) {
    logRequest({ ip, inputLength: messageValidation.inputLength || 0, status: 400, latencyMs: Date.now() - startedAt });
    return res.status(400).json({ error: messageValidation.error });
  }

  const trimmedMessage = messageValidation.trimmedMessage;
  const uploadedImage = req.file || null;

  let modelConfig;
  try {
    modelConfig = getModelConfig(process.env);
  } catch (error) {
    console.error("[local-model] invalid config", error.message);
    logRequest({ ip, inputLength: trimmedMessage.length, status: 502, latencyMs: Date.now() - startedAt });
    return res.status(502).json({ error: "The knowledge interface is offline right now. Please try again later." });
  }

  if (uploadedImage && modelConfig.backend !== "llama-server") {
    logRequest({ ip, inputLength: trimmedMessage.length, status: 400, latencyMs: Date.now() - startedAt });
    return res.status(400).json({ error: "Image input is only available when the local multimodal model is running." });
  }

  let timeout;

  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), modelConfig.timeoutMs);
    const image = uploadedImage
      ? {
          dataUrl: `data:${uploadedImage.mimetype};base64,${uploadedImage.buffer.toString("base64")}`,
          mimeType: uploadedImage.mimetype,
          sizeBytes: uploadedImage.size
        }
      : null;
    const { modelResult, matchedSources } = await answerKnowledgeQuestion({
      message: trimmedMessage,
      image,
      env: process.env,
      signal: controller.signal
    });
    const responseMessage = modelResult.message;

    const latencyMs = Date.now() - startedAt;
    const logId = logChat({
      question: trimmedMessage,
      answer: responseMessage,
      model: modelResult.loggedModel,
      status: "success",
      latencyMs,
      matchedSources,
      userAgent: req.get("user-agent") || "",
      ip,
      hasImage: !!uploadedImage,
      imageMimeType: uploadedImage ? uploadedImage.mimetype : null,
      imageSizeBytes: uploadedImage ? uploadedImage.size : null
    });
    logRequest({ ip, inputLength: trimmedMessage.length, status: 200, latencyMs });
    res.json({ message: responseMessage, logId });
  } catch (error) {
    console.error("[local-model] multimodal request failed", error.message);
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
