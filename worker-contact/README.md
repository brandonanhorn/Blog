# Contact Worker (Cloudflare Worker + Turnstile + Resend)

This Worker receives contact form submissions from the static site in `/docs/contact`, validates them, verifies Cloudflare Turnstile, and forwards messages through Resend.

## 1) Prerequisites

- Cloudflare account with Workers enabled.
- Resend account.
- A verified sending domain/subdomain in Resend (recommended: `mail.brandonanhorn.com`).
- Node.js 18+ for local Wrangler commands.

## 2) Configure Resend domain

In Resend:

1. Add your sending domain/subdomain (for example `mail.brandonanhorn.com`).
2. Add the DNS records Resend gives you (typically SPF + DKIM records and sometimes a verification record) in your DNS provider.
3. Wait until Resend shows the domain as verified.
4. Use a sender address from that domain, e.g. `noreply@mail.brandonanhorn.com`.

`RESEND_TO` is already set to `ai.brandonanhorn@gmail.com` in `wrangler.toml`.

## 3) Worker configuration

`wrangler.toml` includes non-secret values:

- `ALLOWED_ORIGIN` (your website URL, for example `https://www.brandonanhorn.com`)
- `RESEND_FROM` (sender identity on your verified domain)
- `RESEND_TO` (`ai.brandonanhorn@gmail.com`)

Set secrets (never commit these):

```bash
cd worker-contact
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put RESEND_API_KEY
```

## 4) Turnstile site key for frontend

Create a Turnstile widget for your site origin and copy its **site key**.

Then update `docs/contact/index.html`:

- Replace `REPLACE_WITH_TURNSTILE_SITE_KEY` in `data-sitekey`.
- Replace `REPLACE_WITH_WORKER_URL` in the form `action` with your deployed Worker endpoint.

`TURNSTILE_SITE_KEY` is public and belongs in frontend HTML. `TURNSTILE_SECRET_KEY` must remain a Worker secret.

## 5) Deploy Worker

```bash
cd worker-contact
npm install
npx wrangler deploy
```

After deploy, Wrangler prints a Worker URL like:

`https://contact-form-worker.<subdomain>.workers.dev`

Use that URL (or a route on your custom domain) in `docs/contact/index.html` form `action`.

## 6) Safe end-to-end testing

1. Open `/docs/contact/index.html` from your deployed site origin.
2. Submit with valid fields and solve Turnstile.
3. Confirm JSON success response and on-page success message.
4. Confirm message arrives at `ai.brandonanhorn@gmail.com`.
5. Spam checks:
   - Submit with honeypot (`company`) filled using devtools → should fail.
   - Submit with missing/invalid fields → should fail.
   - Submit with invalid Turnstile token → should fail.

## 7) Notes on rate limiting

This Worker is structured for layered anti-spam:

- Turnstile validation
- Honeypot rejection
- Strict required-field validation
- Origin check (`ALLOWED_ORIGIN`)

For additional protection, add a Cloudflare WAF/Rate Limiting rule in front of the Worker route (for example, limit POST requests per IP per minute).
