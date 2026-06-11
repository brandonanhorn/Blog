"use strict";

require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { callLocalModel, getModelConfig } = require("../src/localModel");

const SERVER_ROOT = path.join(__dirname, "..");
const EXPORT_DIR = path.join(SERVER_ROOT, "exports");
const GOLDEN_QUESTIONS_PATH = path.join(EXPORT_DIR, "golden_questions.jsonl");
const MODEL_RUNS_DIR = path.join(EXPORT_DIR, "model_runs");

const SYSTEM_PROMPT = "You are answering as Brandon’s local knowledge assistant. Answer clearly and directly. If the question requires personal context that is not provided, say what information would be needed. Do not invent facts.";
const EVAL_OPTIONS = {
  num_predict: 700,
  temperature: 0.2,
  top_p: 0.9
};

function exitWithMessage(message) {
  console.error(message);
  process.exitCode = 1;
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

function createTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, "").replaceAll(":", "-");
}

function createSafeModelName(modelName) {
  return String(modelName || "local-model")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "local-model";
}

function previewQuestion(question) {
  const normalizedQuestion = String(question || "").replace(/\s+/g, " ").trim();
  if (normalizedQuestion.length <= 80) return normalizedQuestion;
  return `${normalizedQuestion.slice(0, 77)}...`;
}

function buildSystemContent(evaluationGuidance) {
  if (!evaluationGuidance) return SYSTEM_PROMPT;

  return `${SYSTEM_PROMPT}\n\nEvaluation guidance for this benchmark row:\n${JSON.stringify(evaluationGuidance)}`;
}

function normalizeGoldenRecord(record, index) {
  const metadata = record && typeof record.metadata === "object" && record.metadata !== null ? record.metadata : {};

  return {
    id: record?.id || `golden_question_${index + 1}`,
    created_at: record?.created_at || null,
    category: record?.category || "other",
    question: typeof record?.question === "string" ? record.question.trim() : "",
    reference_answer: record?.reference_answer || null,
    matched_sources: Object.prototype.hasOwnProperty.call(record || {}, "matched_sources") ? record.matched_sources : null,
    evaluation_guidance: Object.prototype.hasOwnProperty.call(record || {}, "evaluation_guidance") ? record.evaluation_guidance : null,
    metadata: {
      source: "golden_questions",
      has_image: Boolean(metadata.has_image),
      has_audio: Boolean(metadata.has_audio)
    }
  };
}

function isLocalModelUrl(rawUrl) {
  try {
    const { hostname } = new URL(rawUrl);
    const normalizedHostname = hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return normalizedHostname === "localhost"
      || normalizedHostname === "::1"
      || normalizedHostname === "0.0.0.0"
      || normalizedHostname === "127.0.0.1"
      || normalizedHostname.startsWith("127.");
  } catch (_error) {
    return false;
  }
}

function friendlyErrorMessage(error) {
  if (error?.name === "AbortError") {
    return "Local model request timed out.";
  }

  if (error?.cause?.code === "ECONNREFUSED" || /ECONNREFUSED|fetch failed/i.test(error?.message || "")) {
    return "Could not reach the local model backend. Start the configured local model server and try again.";
  }

  if (error?.message === "unsupported_model_backend") {
    return "Unsupported MODEL_BACKEND. Use ollama or llama-server.";
  }

  if (error?.message === "missing_ollama_config") {
    return "Missing Ollama model configuration.";
  }

  if (error?.message === "missing_llama_server_config") {
    return "Missing llama-server model configuration.";
  }

  if (error?.message === "model_url_must_be_local") {
    return "Model evaluation only supports localhost model URLs.";
  }

  if (/^ollama_http_\d+$/i.test(error?.message || "")) {
    return `Ollama returned ${error.message.replace("ollama_http_", "HTTP ")}.`;
  }

  if (/^llama-server_http_\d+$/i.test(error?.message || "")) {
    return `llama-server returned ${error.message.replace("llama-server_http_", "HTTP ")}.`;
  }

  if (error?.message === "empty_model_response") {
    return "Local model returned an empty response.";
  }

  return error?.message ? String(error.message) : "Local model request failed.";
}

async function evaluateQuestion({ record, modelConfig, runId }) {
  const startedAt = Date.now();
  let timeout;

  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), modelConfig.timeoutMs);
    const result = await callLocalModel({
      messages: [
        { role: "system", content: buildSystemContent(record.evaluation_guidance) },
        { role: "user", content: record.question }
      ],
      options: EVAL_OPTIONS,
      env: process.env,
      signal: controller.signal
    });

    return buildOutputRecord({
      record,
      runId,
      model: result.loggedModel,
      status: "success",
      latencyMs: Date.now() - startedAt,
      modelAnswer: result.message,
      error: null
    });
  } catch (error) {
    return buildOutputRecord({
      record,
      runId,
      model: modelConfig.loggedModel,
      status: "error",
      latencyMs: Date.now() - startedAt,
      modelAnswer: null,
      error: friendlyErrorMessage(error)
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function buildOutputRecord({ record, runId, model, status, latencyMs, modelAnswer, error }) {
  return {
    id: record.id,
    run_id: runId,
    created_at: new Date().toISOString(),
    category: record.category,
    question: record.question,
    reference_answer: record.reference_answer,
    model_answer: modelAnswer,
    model,
    status,
    latency_ms: latencyMs,
    error,
    matched_sources: record.matched_sources,
    evaluation_guidance: record.evaluation_guidance,
    metadata: record.metadata
  };
}

async function main() {
  if (!fs.existsSync(GOLDEN_QUESTIONS_PATH)) {
    exitWithMessage("Missing exports/golden_questions.jsonl. Run npm run export:evaluation first.");
    return;
  }

  let modelConfig;
  let records;

  try {
    modelConfig = getModelConfig(process.env);
    if (!isLocalModelUrl(modelConfig.url)) {
      throw new Error("model_url_must_be_local");
    }
    records = readJsonl(GOLDEN_QUESTIONS_PATH).map(normalizeGoldenRecord).filter((record) => record.question);
  } catch (error) {
    exitWithMessage(`Model evaluation could not start: ${friendlyErrorMessage(error)}`);
    return;
  }

  fs.mkdirSync(MODEL_RUNS_DIR, { recursive: true });

  const timestamp = createTimestamp();
  const safeModelName = createSafeModelName(modelConfig.loggedModel);
  const runId = `${timestamp}_${safeModelName}_${crypto.randomUUID()}`;
  const outputPath = path.join(MODEL_RUNS_DIR, `run_${timestamp}_${safeModelName}.jsonl`);

  fs.writeFileSync(outputPath, "", "utf8");

  console.log("Running model evaluation...");
  console.log(`Model: ${modelConfig.loggedModel}`);
  console.log(`Questions: ${records.length}`);

  let successCount = 0;
  let errorCount = 0;

  for (const [index, record] of records.entries()) {
    console.log(`[${index + 1}/${records.length}] ${record.category} - ${previewQuestion(record.question)}`);
    const outputRecord = await evaluateQuestion({ record, modelConfig, runId });
    fs.appendFileSync(outputPath, `${JSON.stringify(outputRecord)}\n`, "utf8");

    if (outputRecord.status === "success") {
      successCount += 1;
    } else {
      errorCount += 1;
      console.log(`  Error: ${outputRecord.error}`);
    }
  }

  console.log("Evaluation complete.");
  console.log(`Success: ${successCount}`);
  console.log(`Errors: ${errorCount}`);
  console.log(`Output: ${outputPath}`);
}

main().catch((error) => {
  exitWithMessage(`Model evaluation failed: ${friendlyErrorMessage(error)}`);
});
