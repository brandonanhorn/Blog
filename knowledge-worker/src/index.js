import { Budget } from "./budget.js";
import { limitsFrom, neuronsFor, numberVar, worstCaseNeurons } from "./config.js";
import {
  getRelevantContext,
  INDEX_BUILT_AT,
  INDEX_SIZE,
  INDEX_VERSION,
  MAX_CONTEXT_CHARS
} from "./retrieval.js";

export { Budget };

const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";
const DEFAULT_ORIGINS = "https://brandonanhorn.com,https://www.brandonanhorn.com";

const SYSTEM_PROMPT =
  "You are a helpful assistant answering questions about Brandon Anhorn's work and background. " +
  "Use the provided context from Brandon's notes when it is relevant to the user's request. " +
  "If relevant context is present, answer from it and do not claim you lack access. " +
  "Never mention private files, local file paths, or system internals. " +
  "You may summarize public-facing information from Brandon's notes. " +
  "If the context is not relevant or insufficient, say what is missing clearly without inventing details.";

const MAX_QUESTION_CHARS = 4000;

// Backstop only — see the note at the cache write. 30 days.
const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

// Bounds for the pre-call estimate. Context is capped by MAX_CONTEXT_CHARS and
// output by max_tokens, so the true cost can never exceed this.
const CHARS_PER_TOKEN = 3.6;
const MAX_INPUT_TOKENS = Math.ceil(
  (MAX_CONTEXT_CHARS + SYSTEM_PROMPT.length + MAX_QUESTION_CHARS) / CHARS_PER_TOKEN
);

// What the visitor sees when a limit bites. These are answers, not errors —
// see the note on status codes in `respond` below.
const REFUSALS = {
  ip_hour:
    "That's a few questions in quick succession — give it an hour and ask me again. " +
    "If you'd rather not wait, the contact page reaches Brandon directly.",
  ip_day:
    "You've reached today's limit of questions from this connection. " +
    "Try again tomorrow, or use the contact page to reach Brandon directly.",
  daily_asks:
    "I've answered as many questions as I can today. Try me again tomorrow — " +
    "or reach Brandon through the contact page if it's time-sensitive.",
  daily_neurons:
    "I've used up today's budget for generating answers. Try me again tomorrow — " +
    "or reach Brandon through the contact page if it's time-sensitive.",
  disabled:
    "The knowledge interface is paused right now. The contact page still reaches Brandon directly.",
  gate_unavailable:
    "I can't take questions at the moment. Please try again shortly, " +
    "or reach Brandon through the contact page."
};

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || DEFAULT_ORIGINS)
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsHeaders(origin, env) {
  if (!origin || !allowedOrigins(env).includes(origin)) {
    return null;
  }

  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin"
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...(headers || {}) }
  });
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function anonymizeIp(ip) {
  if (!ip) {
    return "unknown";
  }
  if (ip.includes(".")) {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
  }
  return ip.split(":").slice(0, 3).join(":");
}

async function verifyTurnstile(env, token, ip) {
  if (String(env.REQUIRE_TURNSTILE) !== "true") {
    return { ok: true, skipped: true };
  }

  if (!env.TURNSTILE_SECRET) {
    // Configured to require it but no secret bound: refuse rather than run
    // open. This is the same fail-closed rule the budget gate follows.
    console.error("[turnstile] REQUIRE_TURNSTILE is true but TURNSTILE_SECRET is unset");
    return { ok: false };
  }

  if (typeof token !== "string" || !token) {
    return { ok: false };
  }

  const body = new FormData();
  body.append("secret", env.TURNSTILE_SECRET);
  body.append("response", token);
  if (ip) {
    body.append("remoteip", ip);
  }

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body }
    );
    const result = await response.json();
    return { ok: result?.success === true };
  } catch (error) {
    console.error("[turnstile] verification failed", error.message);
    return { ok: false };
  }
}

function normalizeQuestion(question) {
  return question
    .toLowerCase()
    // Drop apostrophes rather than turning them into spaces, so "Brandon's
    // skills" and "Brandons skills" share a cache entry instead of each
    // paying for its own answer. Curly quotes count — the site's own copy
    // uses them, so visitors paste them in.
    .replace(/['‘’]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function handleChat(request, env, ctx, headers) {
  const startedAt = Date.now();
  const ip = request.headers.get("CF-Connecting-IP") || "";

  if (String(env.ENABLED) === "false") {
    return json({ message: REFUSALS.disabled }, 200, headers);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid request. Send JSON with a message field." }, 400, headers);
  }

  const message = body?.message;
  if (typeof message !== "string") {
    return json({ error: "Message must be a string." }, 400, headers);
  }

  const question = message.trim();
  if (!question) {
    return json({ error: "Message cannot be empty." }, 400, headers);
  }
  if (question.length > MAX_QUESTION_CHARS) {
    return json(
      { error: `Message is too long. Max length is ${MAX_QUESTION_CHARS} characters.` },
      400,
      headers
    );
  }

  const turnstile = await verifyTurnstile(env, body?.turnstileToken, ip);
  if (!turnstile.ok) {
    return json(
      { error: "Could not verify that request came from a browser. Please reload and try again." },
      403,
      headers
    );
  }

  const model = env.MODEL || DEFAULT_MODEL;

  // Cache lookup happens BEFORE the gate, so a repeat question costs no
  // neurons and does not count against anyone's per-IP allowance. The index
  // version is part of the key, so republishing the vault invalidates every
  // cached answer without an expiry to tune.
  const cacheKey = `answer:${await sha256Hex(`${normalizeQuestion(question)}|${INDEX_VERSION}`)}`;

  if (env.ANSWER_CACHE) {
    try {
      const cached = await env.ANSWER_CACHE.get(cacheKey, { type: "json" });
      if (cached?.message) {
        // A hit gets its OWN log id rather than replaying the one from the
        // original miss. Feedback is an UPDATE on that row, so sharing an id
        // across everyone who asks a popular question would mean each new
        // rating silently overwrites the last.
        const hitId = crypto.randomUUID();

        console.log(
          JSON.stringify({ event: "cache_hit", ip: anonymizeIp(ip), neurons: 0 })
        );

        if (env.DB) {
          ctx.waitUntil(
            logChat(env, {
              logId: hitId,
              question,
              answer: cached.message,
              model,
              status: "cached",
              latencyMs: Date.now() - startedAt,
              sources: cached.sources || [],
              userAgent: request.headers.get("user-agent") || "",
              ip
            }).catch((error) => console.error("[d1] cache-hit log failed", error.message))
          );
        }

        return json({ message: cached.message, logId: hitId, cached: true }, 200, headers);
      }
    } catch (error) {
      console.error("[cache] read failed", error.message);
    }
  }

  const limits = limitsFrom(env);
  const maxTokens = numberVar(env.MAX_TOKENS, 500);
  const estimate = worstCaseNeurons(model, MAX_INPUT_TOKENS, maxTokens);

  // ---- The hard stop -------------------------------------------------
  // Anything that goes wrong reaching the gate refuses the request. This
  // `catch` is the single line the whole ceiling rests on: make it call the
  // model anyway "so visitors aren't inconvenienced" and there is no ceiling.
  let hold;
  try {
    hold = await env.BUDGET.getByName("global").reserve({ ip, amount: estimate, limits });
  } catch (error) {
    console.error("[budget] gate unreachable, refusing", error.message);
    return json({ message: REFUSALS.gate_unavailable }, 200, headers);
  }

  if (!hold.ok) {
    console.log(JSON.stringify({ event: "refused", reason: hold.reason, ip: anonymizeIp(ip) }));
    return json({ message: REFUSALS[hold.reason] || REFUSALS.daily_asks }, 200, headers);
  }
  // --------------------------------------------------------------------

  const { context, sources } = getRelevantContext(question);
  const systemContent = `${SYSTEM_PROMPT}\n\nRelevant context from Brandon's notes:\n${context}`;

  let answer = "";
  let usage = null;
  let failed = false;

  try {
    const result = await env.AI.run(model, {
      messages: [
        { role: "system", content: systemContent },
        { role: "user", content: question }
      ],
      max_tokens: maxTokens,
      temperature: 0.2,
      top_p: 0.9
    });

    answer = typeof result?.response === "string" ? result.response.trim() : "";
    usage = result?.usage || null;
  } catch (error) {
    console.error("[ai] request failed", error.message);
    failed = true;
  }

  // Settle before responding. A failed call settles with `null`, which charges
  // the full hold — an inference that died partway may still have burned
  // tokens, and the budget should assume it did.
  try {
    await env.BUDGET.getByName("global").settle({
      holdId: hold.holdId,
      neurons: failed || !usage ? null : neuronsFor(model, usage)
    });
  } catch (error) {
    // The hold stays and is swept — and charged — within five minutes.
    console.error("[budget] settle failed, hold will be swept", error.message);
  }

  if (failed || !answer) {
    return json(
      { error: "The knowledge interface is offline right now. Please try again later." },
      502,
      headers
    );
  }

  const latencyMs = Date.now() - startedAt;
  const logId = crypto.randomUUID();

  console.log(
    JSON.stringify({
      event: "answered",
      ip: anonymizeIp(ip),
      latencyMs,
      neurons: usage ? Math.round(neuronsFor(model, usage) * 10) / 10 : null,
      remaining: Math.round(hold.remaining * 10) / 10,
      sources: sources.length
    })
  );

  // Neither of these should delay the answer, and neither is worth failing the
  // request over.
  if (env.ANSWER_CACHE) {
    ctx.waitUntil(
      env.ANSWER_CACHE
        .put(cacheKey, JSON.stringify({ message: answer, sources }), {
          // The index version in the key already invalidates entries whenever
          // the vault is republished. This is only a floor sweep, so keys from
          // long-dead index versions cannot accumulate forever.
          expirationTtl: CACHE_TTL_SECONDS
        })
        .catch((error) => console.error("[cache] write failed", error.message))
    );
  }

  if (env.DB) {
    ctx.waitUntil(
      logChat(env, {
        logId,
        question,
        answer,
        model,
        latencyMs,
        sources,
        userAgent: request.headers.get("user-agent") || "",
        ip
      }).catch((error) => console.error("[d1] log failed", error.message))
    );
  }

  return json({ message: answer, logId }, 200, headers);
}

async function logChat(env, entry) {
  await env.DB.prepare(
    `INSERT INTO chat_logs (
       id, created_at, question, answer, question_length, answer_length,
       model, status, latency_ms, matched_sources, user_agent_hash, ip_hash
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      entry.logId,
      new Date().toISOString(),
      entry.question,
      entry.answer,
      entry.question.length,
      entry.answer.length,
      entry.model,
      entry.status || "success",
      entry.latencyMs,
      JSON.stringify(entry.sources),
      entry.userAgent ? await sha256Hex(entry.userAgent) : null,
      entry.ip ? await sha256Hex(entry.ip) : null
    )
    .run();
}

async function handleFeedback(request, env, headers) {
  if (!env.DB) {
    return json({ error: "Feedback is not available right now." }, 503, headers);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Please provide a valid logId." }, 400, headers);
  }

  const { logId, feedback } = body || {};

  if (typeof logId !== "string" || !logId.trim()) {
    return json({ error: "Please provide a valid logId." }, 400, headers);
  }

  if (feedback !== "helpful" && feedback !== "not_helpful") {
    return json({ error: "Feedback must be either helpful or not_helpful." }, 400, headers);
  }

  const result = await env.DB.prepare(
    "UPDATE chat_logs SET feedback = ?, feedback_created_at = ? WHERE id = ?"
  )
    .bind(feedback, new Date().toISOString(), logId)
    .run();

  if (!result.meta?.changes) {
    return json({ error: "Log entry not found." }, 404, headers);
  }

  return json({ ok: true }, 200, headers);
}

async function handleHealth(request, env, headers) {
  const base = {
    ok: true,
    model: env.MODEL || DEFAULT_MODEL,
    indexVersion: INDEX_VERSION,
    indexBuiltAt: INDEX_BUILT_AT,
    indexCandidates: INDEX_SIZE
  };

  // Budget internals tell an attacker exactly when the allowance is thin, so
  // they need the admin token.
  const token = request.headers.get("X-Admin-Token");
  if (!env.ADMIN_TOKEN || token !== env.ADMIN_TOKEN) {
    return json(base, 200, headers);
  }

  try {
    const status = await env.BUDGET.getByName("global").status({ limits: limitsFrom(env) });
    return json({ ...base, enabled: String(env.ENABLED) !== "false", budget: status }, 200, headers);
  } catch (error) {
    return json({ ...base, budget: { error: error.message } }, 200, headers);
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const url = new URL(request.url);
    const headers = corsHeaders(origin, env);

    // Health is reachable without an Origin header so you can curl it.
    if (request.method === "GET" && url.pathname === "/api/health") {
      return handleHealth(request, env, headers || {});
    }

    if (!headers) {
      return json({ error: "This origin is not allowed." }, 403);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers });
    }

    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405, headers);
    }

    if (!request.headers.get("content-type")?.includes("application/json")) {
      return json({ error: "Requests must use application/json." }, 415, headers);
    }

    try {
      if (url.pathname === "/api/chat") {
        return await handleChat(request, env, ctx, headers);
      }
      if (url.pathname === "/api/feedback") {
        return await handleFeedback(request, env, headers);
      }
      return json({ error: "Not found." }, 404, headers);
    } catch (error) {
      console.error("[worker] unhandled", error.stack || error.message);
      return json({ error: "Unexpected server error." }, 500, headers);
    }
  }
};
