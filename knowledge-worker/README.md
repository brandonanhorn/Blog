# knowledge-worker

The always-on replacement for `ollama-chat-server/`. Answers questions on
brandonanhorn.com from the Obsidian vault, using Workers AI instead of a local
Ollama process, behind a spending ceiling that cannot be talked out of.

Replaces: the Express proxy, `cloudflared`, and the local model — so nothing
needs your Mac awake, and the endpoint hostname never changes again.

```
visitor → GitHub Pages → knowledge-worker.<you>.workers.dev
                              ├── notes index   (bundled JSON, rebuilt by CI)
                              ├── answer cache  (KV, optional)
                              ├── chat logs     (D1, optional)
                              └── budget gate   (Durable Object) → Workers AI
```

## Layout

| File | What it is |
| --- | --- |
| `src/index.js` | Request handling, CORS, Turnstile, cache, the call to Workers AI |
| `src/budget.js` | The Durable Object holding the spending ceiling |
| `src/retrieval.js` | Keyword retrieval, ported from `ollama-chat-server/src/retrieval.js` |
| `src/text.js` | Tokenizing and chunking, shared with the index builder |
| `src/config.js` | Neuron rates per model, budget arithmetic |
| `src/index.json` | Generated, **not committed**. The vault, chunked and tokenized |
| `scripts/build-index.js` | Vault → `index.json`, including the publish policy |
| `schema.sql` | D1 schema, carried over from `chatLog.js` |
| `test/` | Budget and retrieval tests, run in real workerd |

## First deploy

The Worker runs with just the AI binding and the Durable Object — KV and D1 are
optional and skipped if unbound, so you can get it live and add them after.

```bash
npm install
npm run build:index          # reads ~/Documents/brain
npx wrangler login
npm run deploy
```

Check it:

```bash
curl https://knowledge-worker.<you>.workers.dev/api/health
```

Then point the site at it — one line in `docs/knowledge/knowledge.js`:

```js
const API_URL = "https://knowledge-worker.<you>.workers.dev/api/chat";
```

While you're in that file, `knowledge.js:33` still says *"This answer is being
generated locally."* That stops being true here.

### Adding the cache and the logs

```bash
npx wrangler kv namespace create ANSWER_CACHE
npx wrangler d1 create knowledge-logs
npx wrangler d1 execute knowledge-logs --remote --file=./schema.sql
```

Paste the printed ids into the commented block at the bottom of
`wrangler.jsonc`, uncomment it, and redeploy.

### Turnstile

`REQUIRE_TURNSTILE` ships as `"false"` so the first deploy works. **Until you
turn it on, a script can hit the endpoint in a loop** — it will be stopped by
the per-IP limit and the daily budget, but it will consume them.

1. Create a Turnstile widget for `brandonanhorn.com` in the Cloudflare dashboard.
2. `npx wrangler secret put TURNSTILE_SECRET`
3. Add the widget to the ask form and send its token as `turnstileToken`
   alongside `message` in the POST body.
4. Set `REQUIRE_TURNSTILE` to `"true"` in `wrangler.jsonc` and redeploy.

## The budget

Workers AI's 10,000 free neurons a day are an **account** allowance, shared with
every other Worker on the account. `DAILY_NEURONS` is this project's reserved
share of it, not the whole thing.

| Var | Default | Meaning |
| --- | --- | --- |
| `DAILY_NEURONS` | `3000` | Hard ceiling. Nothing calls the model past this |
| `DAILY_ASKS` | `150` | Coarse second guard, in case the rate table goes stale |
| `IP_PER_HOUR` | `6` | Per-address, per hour |
| `IP_PER_DAY` | `20` | Per-address, per day |
| `MAX_TOKENS` | `500` | Answer length cap |
| `ENABLED` | `"true"` | Kill switch — set `"false"` in the dashboard, no redeploy |

At the pinned model (`llama-3.1-8b-instruct-fp8-fast`, 4,119 neurons/M in,
34,868 out) a question costs about 19–22 neurons, so 3,000 buys roughly 140–150
answers a day. Cache hits cost nothing and are not counted.

**Changing the model:** update `MODEL` in `wrangler.jsonc` *and* make sure its
rate is in `MODEL_RATES` in `src/config.js`. An unlisted model falls back to a
deliberately expensive rate, so the gate over-charges rather than letting spend
run unmeasured.

### How the ceiling actually holds

Two properties, both tested in `test/budget.test.js`:

- **Cost is held before the call and settled after.** Charging only on the way
  back leaves a window where the ledger reads zero while N calls are in flight.
  The test fires ten simultaneous asks at a budget that fits three; three are
  admitted.
- **Everything unaccounted-for is charged.** A hold that is never settled gets
  swept and billed at its estimate after five minutes. A call that throws
  settles at the full estimate rather than being forgiven — a partial inference
  may still have burned tokens.

And one rule that lives in `src/index.js`: **if the gate is unreachable, the
request is refused.** The `catch` around `reserve()` is the single line the
whole ceiling rests on. Making it call the model anyway "so visitors aren't
inconvenienced" removes the ceiling entirely.

### Watching it

```bash
npx wrangler tail                                    # live requests
npx wrangler secret put ADMIN_TOKEN                  # then:
curl -H "X-Admin-Token: <token>" \
  https://knowledge-worker.<you>.workers.dev/api/health
```

With the token, `/api/health` reports today's spend, holds, asks and refusals.
Without it, only the model and index version — budget internals tell an
attacker exactly when the allowance is thin.

If questions start failing while your own ledger shows headroom, the other site
on the account has spent the shared 10,000. That shows in the Workers AI
dashboard, not here.

## What gets published

The site is public, so the bot answers from whatever is in `index.json`. The
policy lives at the top of `scripts/build-index.js` and is an **allowlist**, so
a folder you add to the vault later stays private until you say otherwise.

```js
const PUBLIC_FOLDERS = ["projects", "life", "notes"];
```

Per-note frontmatter overrides it either way:

```markdown
---
public: false     # keep this note out, even inside an allowed folder
---
```

Today that publishes 9 notes as 32 candidates (~82 KB) and excludes `people/`,
`ideas/` and the vault root. The builder prints exactly what it did, and fails
the build if nothing was published.

## Tests

```bash
npm test
```

Runs in real workerd against the bindings in `wrangler.jsonc`, so the Durable
Object under test is the one that ships.

## Keeping it current

`index.json` is a build artifact and is **gitignored on purpose**: this repo is
public, and that file holds the verbatim text of every published note. Keeping
it out means a note you add to `life/` tomorrow can't land in public git history
before you've thought about it. `npm run deploy` rebuilds it first, so:

```bash
npm run deploy
```

To make it automatic — the point of the whole exercise — see
`github-workflow-example.yml` in this folder. It belongs in the *vault* repo,
not this one.
