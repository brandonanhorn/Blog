// Model pricing and budget arithmetic.
//
// Neuron prices are per MILLION tokens, taken from Cloudflare's Workers AI
// pricing table. If you change MODEL in wrangler.jsonc, make sure its rate is
// listed here — an unlisted model falls back to FALLBACK_RATE, which is
// deliberately pessimistic so the gate over-charges rather than under-charges.

export const MODEL_RATES = {
  "@cf/meta/llama-3.1-8b-instruct-fp8-fast": { in: 4119, out: 34868 },
  "@cf/meta/llama-3.1-8b-instruct-fp8": { in: 13778, out: 26128 },
  "@cf/meta/llama-3.1-8b-instruct-awq": { in: 11161, out: 24215 },
  "@cf/meta/llama-3.1-8b-instruct": { in: 25608, out: 75147 },
  "@cf/meta/llama-3.2-3b-instruct": { in: 4625, out: 30475 },
  "@cf/meta/llama-3.2-1b-instruct": { in: 2457, out: 18252 },
  "@cf/mistral/mistral-7b-instruct-v0.1": { in: 10000, out: 17300 },
  "@cf/google/gemma-4-26b-a4b-it": { in: 9091, out: 27273 }
};

// Roughly the dearest text model on the platform. Used only when MODEL is not
// in the table above, so an unknown model is expensive rather than free.
const FALLBACK_RATE = { in: 26668, out: 204805 };

export function rateFor(model) {
  return MODEL_RATES[model] || FALLBACK_RATE;
}

// Exact cost of a completed call, from the usage object Workers AI returns.
export function neuronsFor(model, usage) {
  const rate = rateFor(model);
  const inTokens = Number(usage?.prompt_tokens) || 0;
  const outTokens = Number(usage?.completion_tokens) || 0;
  return (inTokens * rate.in + outTokens * rate.out) / 1e6;
}

// What we hold against the budget BEFORE the call, when the true cost is not
// yet known. Both halves are bounded: input by MAX_CONTEXT_CHARS in
// retrieval.js plus the system prompt, output by max_tokens.
export function worstCaseNeurons(model, maxInputTokens, maxOutputTokens) {
  const rate = rateFor(model);
  return (maxInputTokens * rate.in + maxOutputTokens * rate.out) / 1e6;
}

// Read a numeric var from wrangler.jsonc, which delivers everything as strings.
export function numberVar(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function limitsFrom(env) {
  return {
    dailyNeurons: numberVar(env.DAILY_NEURONS, 3000),
    dailyAsks: numberVar(env.DAILY_ASKS, 150),
    ipPerHour: numberVar(env.IP_PER_HOUR, 6),
    ipPerDay: numberVar(env.IP_PER_DAY, 20)
  };
}
