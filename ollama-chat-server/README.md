# Local Knowledge Proxy (Local-First)

This folder contains a local backend proxy that safely connects your static GitHub Pages frontend to a local model backend running on your laptop. It supports the existing Ollama backend and an optional llama.cpp `llama-server` backend.

## 1) Local architecture

`User → website → Cloudflare Tunnel → local proxy → Ollama or llama.cpp llama-server`

- The website is static (GitHub Pages), so it cannot run local models or server routes.
- Cloudflare Tunnel should expose **only** this local proxy service.
- Express `trust proxy` is set to `1` because the app runs behind Cloudflare Tunnel.
- Ollama or `llama-server` should remain local on `127.0.0.1`.

## 2) Choose a local model backend

The proxy keeps Ollama as the default backend and can optionally call an OpenAI-compatible llama.cpp `llama-server`.

### Existing Ollama mode

In one terminal, start Ollama with the default model:

```bash
ollama run hermes31-8b-q4
```

Then run the proxy from `ollama-chat-server/`:

```bash
npm install
MODEL_BACKEND=ollama npm start
```

This uses the Ollama API endpoint `http://127.0.0.1:11434/api/chat` by default.

### New llama-server mode

In one terminal, start llama.cpp with the Gemma 4 12B GGUF model:

```bash
llama-server -hf ggml-org/gemma-4-12B-it-GGUF
```

Then run the proxy from `ollama-chat-server/`:

```bash
npm install
MODEL_BACKEND=llama-server npm start
```

This uses the OpenAI-compatible llama.cpp chat completions endpoint `http://127.0.0.1:8080/v1/chat/completions` by default. Gemma 4 can be slower than Hermes, so llama-server requests default to a longer 90 second timeout.

### Backend environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `MODEL_BACKEND` | `ollama` | Local backend to call. Use `ollama` or `llama-server`. |
| `OLLAMA_MODEL` | `hermes31-8b-q4` | Model name sent to Ollama. |
| `OLLAMA_URL` | `http://127.0.0.1:11434/api/chat` | Ollama chat API URL. |
| `OLLAMA_TIMEOUT_MS` | `30000` | Ollama request timeout in milliseconds. |
| `LLAMA_SERVER_URL` | `http://127.0.0.1:8080/v1/chat/completions` | llama.cpp OpenAI-compatible chat completions URL. |
| `LLAMA_SERVER_MODEL` | `gemma-4-12B-it-GGUF` | Model name sent to `llama-server`. |
| `LLAMA_SERVER_TIMEOUT_MS` | `90000` | llama-server request timeout in milliseconds. Increase this if Gemma 4 responses need more time. |

By default, the proxy runs on `http://127.0.0.1:8787`.

Gemma 4 multimodal image input is available through the separate `/api/chat-multimodal` endpoint when `MODEL_BACKEND=llama-server`. The original `/api/chat` endpoint remains text-only. Audio input is not enabled yet.

## Experimental Image Input

The knowledge interface can optionally send one image with a question through `POST /api/chat-multimodal` when the local llama.cpp backend is active.

- Images are processed in memory only.
- Images are not stored.
- Raw image bytes and base64 data URLs are never written to SQLite.
- Chat logs store only image metadata: whether an image was attached, MIME type, and size in bytes.
- Supported image types: PNG, JPEG, WebP.
- Maximum image size: 5 MB.
- Requires `MODEL_BACKEND=llama-server`. If another backend is active, image input is rejected with a friendly JSON error.
- Audio is not enabled yet.

Start llama-server with the local multimodal Gemma command:

```bash
cd /Users/ban/Documents/llama.cpp
./build/bin/llama-server -hf unsloth/gemma-4-12b-it-GGUF:UD-Q4_K_XL
```

Then run the proxy from `ollama-chat-server/` with:

```bash
MODEL_BACKEND=llama-server npm start
```

## 3) Run the proxy

From `ollama-chat-server/`, start the selected backend first, then run:

```bash
npm install
npm start
```

## Using Obsidian as Knowledge Source

- Place your markdown notes (`.md`) anywhere inside this local vault path:

  ```
  /Users/ban/Documents/brain
  ```

- On server start, the proxy recursively loads all markdown files from that fixed vault path, extracts plain text, chunks it in memory, and uses relevant chunks to augment the system prompt.
- Notes are loaded only from that fixed local path (no client-controlled file reads, and no raw vault files are exposed over the API).
- Restart the server after adding or editing notes so the in-memory retrieval index refreshes.

- Retrieval is keyword-and-metadata based (no embeddings yet): each chunk keeps `filePath`, `fileName`, `folder`, optional note title, and chunk text.
- Ranking includes strong boosts for filename/folder/path matches (for example, queries like `career`, `writing`, `background`, `experience`, and `summary` strongly prefer `writing/career_summary.md`).
- Query tokenization lowercases, strips punctuation, splits snake_case/kebab-case, and does light plural normalization.
- Simple synonym expansion is included for profile-style terms (career, hiring, skills, projects, writing).
- For short notes (about 6000 chars or less), retrieval also indexes the full note as a fallback candidate in addition to normal chunks.
- Retrieval debug logs only top source paths + scores (no full note or prompt logging).

## 4) Test locally with curl

```bash
curl -X POST http://127.0.0.1:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Summarize the purpose of this interface in one sentence."}'
```

Expected success payload:

```json
{ "message": "model response text", "logId": "sqlite-log-id" }
```

Expected error payload:

```json
{ "error": "friendly error message" }
```

## Quick retrieval smoke test

Ask a career-focused question to verify filename/path boosting:

```bash
curl -i http://127.0.0.1:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Can you tell me about Brandon's career?"}'
```

Expected behavior:

- The retrieval logs should show `writing/career_summary.md` (or `career_summary.md`) among top matches.
- The assistant answer should summarize Brandon's career from retrieved note context instead of saying it lacks career information.

## 5) Expose the proxy with Cloudflare Tunnel

1. Install `cloudflared`.
2. Start a tunnel to your local proxy port (example):

   ```bash
   cloudflared tunnel --url http://127.0.0.1:8787
   ```

3. Cloudflare returns a public HTTPS tunnel URL.
4. Use that URL in the frontend endpoint (with `/api/chat` appended).

## 6) Availability note

Your laptop must be awake, online, and running the proxy plus the selected local model backend for the knowledge interface to work.

## 7) Keep local model backends private

- Keep Ollama and `llama-server` bound to localhost.
- Do **not** expose `11434` or `8080` publicly.
- Only expose the local proxy through Cloudflare Tunnel.

## 8) Do not commit model files

GGUF/model files are large local artifacts and should **never** be committed to this repository.

## 9) Frontend endpoint replacement

In `docs/knowledge/knowledge.js`, replace:

```js
const API_URL = "REPLACE_WITH_OLLAMA_PROXY_URL";
```

with your tunnel endpoint plus `/api/chat`, for example:

```js
const API_URL = "https://your-tunnel-subdomain.trycloudflare.com/api/chat";
```

## 10) Deployment note

This is a **local-first experimental setup**, not an always-on production deployment.

## Security behavior in this proxy

- POST-only endpoints: `/api/chat`, `/api/chat-multimodal`, and `/api/feedback`
- `/api/chat` accepts only JSON with exactly one field: `{ "message": "..." }`; `/api/chat-multimodal` accepts multipart form data with `message` and one optional `image` file
- Rejects missing/invalid/empty/too-long messages
- Fixed system prompt/options on the server; local backend URL/model are selected through environment variables
- Helmet enabled
- JSON body limit set to `16kb`
- Rate limit: 10 requests/minute/IP
- CORS restricted to explicit origins (no production wildcard)
- Backend-specific timeout when contacting the local model backend: Ollama defaults to 30 seconds, and llama-server defaults to 90 seconds (`LLAMA_SERVER_TIMEOUT_MS` can override it)
- No full prompt logging (logs only metadata)
- Uploaded images use in-memory handling only; the proxy never writes images, raw bytes, or base64 data URLs to disk or SQLite


## Local Chat Logging

- Completed question/answer pairs are stored locally in SQLite at `data/chat_logs.sqlite`.
- The database stays local and is ignored by git (`ollama-chat-server/data/` is in `.gitignore`).
- Only the backend writes logs after successful model responses; there is no frontend log page and no HTTP route to read logs.
- The SQLite `model` field stores the backend and model used, such as `ollama:hermes31-8b-q4` or `llama-server:gemma-4-12B-it-GGUF`.
- Raw IP addresses and raw User-Agent strings are never stored; SHA-256 hashes are stored instead.
- Image uploads are not stored. Only `has_image`, `image_mime_type`, and `image_size_bytes` are logged for successful multimodal requests.

Inspect logs locally:

```bash
sqlite3 data/chat_logs.sqlite
.tables
SELECT created_at, question, substr(answer, 1, 200) FROM chat_logs ORDER BY created_at DESC LIMIT 10;
```

## Answer Feedback

- Public users can mark responses as `helpful` or `not_helpful` from the homepage UI.
- Feedback is stored locally in SQLite (`data/chat_logs.sqlite`) on the matching chat log row.
- There is no public endpoint to read chat logs; only write-only feedback submission is exposed.
- Feedback helps evaluate retrieval relevance and answer quality over time.

## Feedback Dataset Export

The local feedback exporter turns stored `helpful` and `not_helpful` chat logs into JSONL datasets that can be used later for model evaluation, fine-tuning experiments, preference learning, or prompt improvement. It is a data export tool only; it does not train a model, change API behavior, change logging behavior, upload data, or expose exported data publicly.

Run from `ollama-chat-server/`:

```bash
npm run export:feedback
```

The exporter reads the local SQLite database at `data/chat_logs.sqlite`, opens it in read-only mode, and writes these files to the local `exports/` directory:

- `exports/helpful_answers.jsonl` — one JSON object per successful row marked `helpful`.
- `exports/not_helpful_answers.jsonl` — one JSON object per successful row marked `not_helpful`.
- `exports/preference_dataset.jsonl` — simple preference-training candidates with helpful answers as `chosen` and not-helpful answers as `rejected`.

The `exports/` directory is gitignored (`ollama-chat-server/exports/`) so generated datasets stay local and should not be committed. These labels are only the foundation for future preference datasets, DPO, fine-tuning, or prompt evaluation work; no training happens in this project yet.

## Evaluation Dataset Export

The local evaluation exporter turns successful, `helpful` chat logs into deterministic JSONL benchmark files for comparing future models, prompts, retrieval changes, and fine-tuned versions of the Brandon knowledge interface. It is an evaluation preparation tool only: it does not train a model, call external APIs, change website behavior, change backend behavior, upload data, or expose exported data publicly.

Run from `ollama-chat-server/`:

```bash
npm run export:evaluation
```

The exporter reads only the local SQLite database at `data/chat_logs.sqlite`, opens it in read-only mode, keeps the earliest helpful answer for each normalized unique question, and writes these files to the local `exports/` directory:

- `exports/evaluation_dataset.jsonl` — the full deduplicated local evaluation dataset, with each record containing the question, reference answer, inferred category, model, matched sources when available, evaluation guidance, and basic metadata.
- `exports/golden_questions.jsonl` — a smaller benchmark set of up to 25 records selected deterministically from the evaluation dataset, preferring category diversity and including at least one record per available category.

Use these files to compare model versions, prompt revisions, retrieval changes, or future fine-tuned variants against stable local reference answers. These exports are not training data by default, and running the exporter does not perform any training.

The `exports/` directory is gitignored (`ollama-chat-server/exports/`) so generated evaluation files stay local and should not be committed.


## Model Evaluation Runner

The local model evaluation runner executes the currently configured local model against `exports/golden_questions.jsonl` and writes the model's answers to a timestamped JSONL file for review. It is intended for comparing model quality before changing prompts, retrieval behavior, or model weights.

Run from `ollama-chat-server/` after creating the golden questions export:

```bash
npm run export:evaluation
npm run eval:model
```

`npm run eval:model` uses the same local backend environment variables as the proxy (`MODEL_BACKEND`, `OLLAMA_MODEL`, `OLLAMA_URL`, `LLAMA_SERVER_MODEL`, `LLAMA_SERVER_URL`, `OLLAMA_TIMEOUT_MS`, and `LLAMA_SERVER_TIMEOUT_MS`). Use those variables to compare Hermes, Gemma, or future local models without changing server behavior.

Hermes / Ollama example:

```bash
MODEL_BACKEND=ollama OLLAMA_MODEL=hermes31-8b-q4 npm run eval:model
```

Gemma / llama-server example:

```bash
MODEL_BACKEND=llama-server LLAMA_SERVER_MODEL=gemma-4-12b-it-GGUF npm run eval:model
```

The runner reads only `exports/golden_questions.jsonl`, calls the configured local model once per question, and writes local-only review files under `exports/model_runs/`, such as `exports/model_runs/run_2026-06-04T15-30-00_ollama-hermes31-8b-q4.jsonl`. The output directory is covered by the existing `ollama-chat-server/exports/` gitignore rule, so model run files should not be committed or exposed publicly.

This is file-based evaluation only. It does not train a model, write to SQLite, call external APIs, mutate `golden_questions.jsonl`, change backend API behavior, change retrieval behavior, or change the website. Version 1 evaluates the raw model answer to each question; a future version can evaluate the full RAG pipeline and add a separate reviewer/scoring script.

## Manual Evaluation Review

The local evaluation review exporter converts the latest timestamped model run JSONL file from `exports/model_runs/` into a human-editable CSV review sheet. It is local-only: it does not call external APIs, upload to Google, write to SQLite, train a model, change backend behavior, change retrieval behavior, or change the website.

Run from `ollama-chat-server/` after creating a model run:

```bash
npm run eval:model
npm run review:evaluation
```

`npm run review:evaluation` reads the most recently modified `exports/model_runs/run_*.jsonl` file and writes a CSV file under `exports/reviews/`, such as `exports/reviews/review_<run_id>.csv`. The generated review directory is covered by the existing `ollama-chat-server/exports/` gitignore rule, so review sheets stay local unless you intentionally share them.

Open or import the CSV in Google Sheets, Numbers, or Excel, then manually fill the blank `score`, `verdict`, and `notes` columns. Recommended score scale:

- `5` = excellent, sounds like Brandon, grounded, useful
- `4` = good, minor issue
- `3` = okay, usable but bland
- `2` = weak, missing key context
- `1` = bad, wrong or hallucinated

Recommended verdict values:

- `better_than_reference`
- `same_as_reference`
- `worse_than_reference`
- `not_enough_context`

Reviewed sheets can later be imported to create chosen/rejected preference datasets for evaluation or training experiments. This script only creates the manual review sheet; it does not perform that import or train anything.

## Local Admin Log Viewer

Run locally:

```bash
npm run admin
```

Open:

```text
http://127.0.0.1:8788/
```

Important:

- This viewer is local-only and binds to `127.0.0.1`.
- Do **not** expose port `8788` through Cloudflare Tunnel.
- Do **not** publish this admin viewer in GitHub Pages.

## Manual Test Steps

1. Start proxy:

```bash
npm start
```

2. Send chat request:

```bash
curl -X POST http://127.0.0.1:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Can you tell me about Brandon’s career?"}'
```

Expected: response includes `message` and `logId`.

3. Submit feedback:

```bash
curl -X POST http://127.0.0.1:8787/api/feedback \
  -H "Content-Type: application/json" \
  -d '{"logId":"PASTE_LOG_ID","feedback":"helpful"}'
```

Expected: `{ "ok": true }`.

4. Start admin:

```bash
npm run admin
```

5. Open `http://127.0.0.1:8788/` and confirm the latest log + feedback value appear.
