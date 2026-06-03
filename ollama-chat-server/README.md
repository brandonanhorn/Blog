# Local Knowledge Proxy (Local-First)

This folder contains a local backend proxy that safely connects your static GitHub Pages frontend to a local model backend running on your laptop. It supports the existing Ollama backend and an optional llama.cpp `llama-server` backend.

## 1) Local architecture

`User → website → Cloudflare Tunnel → local proxy → Ollama or llama.cpp llama-server`

- The website is static (GitHub Pages), so it cannot run local models or server routes.
- Cloudflare Tunnel should expose **only** this local proxy service.
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

This uses the OpenAI-compatible llama.cpp chat completions endpoint `http://127.0.0.1:8080/v1/chat/completions` by default.

### Backend environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `MODEL_BACKEND` | `ollama` | Local backend to call. Use `ollama` or `llama-server`. |
| `OLLAMA_MODEL` | `hermes31-8b-q4` | Model name sent to Ollama. |
| `OLLAMA_URL` | `http://127.0.0.1:11434/api/chat` | Ollama chat API URL. |
| `LLAMA_SERVER_URL` | `http://127.0.0.1:8080/v1/chat/completions` | llama.cpp OpenAI-compatible chat completions URL. |
| `LLAMA_SERVER_MODEL` | `gemma-4-12B-it-GGUF` | Model name sent to `llama-server`. |

By default, the proxy runs on `http://127.0.0.1:8787`.

Gemma 4 multimodal capabilities are not wired into this app yet. The current public API and frontend remain text-only; image or audio input would require separate frontend and backend changes.

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

- POST-only endpoint: `/api/chat`
- Accepts only JSON with exactly one field: `{ "message": "..." }`
- Rejects missing/invalid/empty/too-long messages
- Fixed system prompt/options on the server; local backend URL/model are selected through environment variables
- Helmet enabled
- JSON body limit set to `16kb`
- Rate limit: 10 requests/minute/IP
- CORS restricted to explicit origins (no production wildcard)
- 30 second timeout when contacting the local model backend
- No full prompt logging (logs only metadata)


## Local Chat Logging

- Completed question/answer pairs are stored locally in SQLite at `data/chat_logs.sqlite`.
- The database stays local and is ignored by git (`ollama-chat-server/data/` is in `.gitignore`).
- Only the backend writes logs after successful model responses; there is no frontend log page and no HTTP route to read logs.
- The SQLite `model` field stores the backend and model used, such as `ollama:hermes31-8b-q4` or `llama-server:gemma-4-12B-it-GGUF`.
- Raw IP addresses and raw User-Agent strings are never stored; SHA-256 hashes are stored instead.

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
