"use strict";

const DEFAULT_MODEL_BACKEND = "ollama";
const DEFAULT_OLLAMA_MODEL = "hermes31-8b-q4";
const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434/api/chat";
const DEFAULT_LLAMA_SERVER_URL = "http://127.0.0.1:8080/v1/chat/completions";
const DEFAULT_LLAMA_SERVER_MODEL = "gemma-4-12B-it-GGUF";

function getModelConfig(env = process.env) {
  const backend = (env.MODEL_BACKEND || DEFAULT_MODEL_BACKEND).trim();
  const ollamaModel = (env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL).trim();
  const ollamaUrl = (env.OLLAMA_URL || DEFAULT_OLLAMA_URL).trim();
  const llamaServerUrl = (env.LLAMA_SERVER_URL || DEFAULT_LLAMA_SERVER_URL).trim();
  const llamaServerModel = (env.LLAMA_SERVER_MODEL || DEFAULT_LLAMA_SERVER_MODEL).trim();

  if (backend !== "ollama" && backend !== "llama-server") {
    throw new Error("unsupported_model_backend");
  }

  if (backend === "ollama" && (!ollamaModel || !ollamaUrl)) {
    throw new Error("missing_ollama_config");
  }

  if (backend === "llama-server" && (!llamaServerModel || !llamaServerUrl)) {
    throw new Error("missing_llama_server_config");
  }

  return {
    backend,
    url: backend === "llama-server" ? llamaServerUrl : ollamaUrl,
    model: backend === "llama-server" ? llamaServerModel : ollamaModel,
    loggedModel: backend === "llama-server" ? `llama-server:${llamaServerModel}` : `ollama:${ollamaModel}`
  };
}

function buildPayload({ messages, options, env }) {
  const config = getModelConfig(env);

  if (config.backend === "llama-server") {
    return {
      config,
      payload: {
        model: config.model,
        messages,
        temperature: options.temperature,
        top_p: options.top_p,
        max_tokens: options.num_predict,
        stream: false
      }
    };
  }

  return {
    config,
    payload: {
      model: config.model,
      stream: false,
      messages,
      options
    }
  };
}

function parseModelResponse({ backend, data }) {
  if (backend === "llama-server") {
    return typeof data?.choices?.[0]?.message?.content === "string" ? data.choices[0].message.content.trim() : "";
  }

  return typeof data?.message?.content === "string" ? data.message.content.trim() : "";
}

async function callLocalModel({ messages, options, env = process.env, signal }) {
  const { config, payload } = buildPayload({ messages, options, env });
  const modelResponse = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal
  });

  if (!modelResponse.ok) {
    throw new Error(`${config.backend}_http_${modelResponse.status}`);
  }

  const data = await modelResponse.json();
  const message = parseModelResponse({ backend: config.backend, data });
  if (!message) {
    throw new Error("empty_model_response");
  }

  return {
    message,
    backend: config.backend,
    model: config.model,
    loggedModel: config.loggedModel
  };
}

module.exports = {
  callLocalModel,
  getModelConfig,
  DEFAULT_MODEL_BACKEND,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_URL,
  DEFAULT_LLAMA_SERVER_URL,
  DEFAULT_LLAMA_SERVER_MODEL
};
