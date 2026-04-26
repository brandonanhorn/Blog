# Ollama Chat Proxy (Local-First)

This folder contains a local backend proxy that safely connects your static GitHub Pages frontend to Ollama running on your laptop.

## 1) Local architecture

`User → website → Cloudflare Tunnel → local proxy → Ollama`

- The website is static (GitHub Pages), so it cannot run Ollama or server routes.
- Cloudflare Tunnel should expose **only** this local proxy service.
- Ollama should remain local on `127.0.0.1`.

## 2) Run Ollama locally

```bash
ollama run hermes31-8b-q4
```

This starts the model on the default local Ollama API endpoint (`http://127.0.0.1:11434`).

## 3) Run the proxy

From `ollama-chat-server/`:

```bash
npm install
npm start
```

By default, the proxy runs on `http://127.0.0.1:8787`.

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
curl -i http://127.0.0.1:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Summarize the purpose of this interface in one sentence."}'
```

Expected success payload:

```json
{ "message": "model response text" }
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

Your laptop must be awake, online, and running both Ollama and the proxy for the knowledge interface to work.

## 7) Keep Ollama private

- Keep Ollama bound to localhost.
- Do **not** expose `11434` publicly.
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
- Fixed Ollama URL/model/system prompt/options on the server
- Helmet enabled
- JSON body limit set to `16kb`
- Rate limit: 10 requests/minute/IP
- CORS restricted to explicit origins (no production wildcard)
- 30 second timeout when contacting Ollama
- No full prompt logging (logs only metadata)
