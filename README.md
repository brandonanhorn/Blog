# brandonanhorn.com

My personal site and **Ask Brandon**, a question box on the homepage that answers from my notes with an open-source model.

**Live:** [brandonanhorn.com](https://brandonanhorn.com)

## What's in here

| Folder | What it is |
|---|---|
| [`knowledge-worker/`](knowledge-worker) | **Start here.** The Ask Brandon backend: a Cloudflare Worker on Workers AI with a Durable-Object spending ceiling, KV answer cache, D1 chat and feedback logs, Turnstile, and tests that run in workerd. |
| [`docs/`](docs) | The static site, including the ask box in `docs/knowledge/`. |
| [`worker-contact/`](worker-contact) | The contact form Worker: validation, Turnstile, delivery through Resend. |
| [`ollama-chat-server/`](ollama-chat-server) | The original local-first backend: an Express proxy to Ollama or llama.cpp over a Cloudflare Tunnel, with image input. Kept for reference. |
| `content/`, `theme/`, `pelicanconf.py`, `scripts/` | The original Pelican blog. `scripts/build_archive.py` turns its posts into the archive pages under `docs/archive/`. |

## How Ask Brandon works

```
visitor → GitHub Pages → knowledge-worker (Cloudflare Workers)
                              ├── notes index           bundled JSON, rebuilt on every deploy
                              ├── answer cache          KV
                              ├── chat + feedback logs  D1
                              └── budget gate           Durable Object → Workers AI
```

Three design choices worth a look:

1. **The budget reserves before it spends.** Cost is held before each model call and settled after, so ten simultaneous questions against a budget that fits three admit exactly three. Holds that never settle are swept and charged. If the gate can't be reached, the request is refused rather than sent to the model. See [`src/budget.js`](knowledge-worker/src/budget.js) and [`test/budget.test.js`](knowledge-worker/test/budget.test.js).
2. **Private by default.** Notes are published only from allowlisted folders, a frontmatter flag can pull any note out, and the build fails if a published note still states a fact that has changed. See [`scripts/build-index.js`](knowledge-worker/scripts/build-index.js).
3. **Retrieval is checked, not assumed.** The latest scoring change was validated against a 43-question probe set before it shipped. See [`src/retrieval.js`](knowledge-worker/src/retrieval.js).

## Run it

```bash
cd knowledge-worker
npm install
npm test          # Vitest in workerd
npm run deploy    # rebuilds the index from the notes vault, then deploys
```

The index is built from a private Obsidian vault and is never committed. Full setup and the budget arithmetic are in [`knowledge-worker/README.md`](knowledge-worker/README.md).
