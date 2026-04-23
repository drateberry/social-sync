# Crosspost

Personal cross-platform social sync for **X**, **Mastodon**, and **Bluesky**. Post to any one of them and the post fans out to the other two within ~15 minutes.

Single-tenant, self-hosted, runs on Cloudflare Workers + D1 + R2 + Queues. Released as FOSS (MIT).

This README covers local development, platform OAuth setup, and deployment. For the design rationale (especially loop prevention), see [`docs/architecture.md`](./docs/architecture.md). For X API cost tuning, see [`docs/costs.md`](./docs/costs.md).

---

## Repo layout

```
/shared      TypeScript types shared between worker and web
/worker      Cloudflare Worker (pollers, publishers, orchestrator, queue consumer, admin API)
  /migrations  D1 schema migrations
  /tests       Vitest unit tests (loop prevention canary lives here)
/web         Next.js (App Router) dashboard, deployed to Cloudflare Pages
/docs        Architecture + cost notes
```

## Local development

Requirements: Node 20+, `wrangler` (installed as a worker devDependency).

```bash
npm install
npm run test           # run the full test suite across workspaces
npm run worker:dev     # run the worker locally via wrangler dev
npm run web:dev        # run the dashboard on http://localhost:3000
```

The canary test (`worker/tests/loop-prevention.test.ts`) is the one test you must never let regress. It covers the X→Mastodon→poll-Mastodon scenario and every loop-prevention rule individually.

## One-time Cloudflare setup

1. **Create the D1 database.**
   ```bash
   wrangler d1 create crosspost
   ```
   Copy the returned `database_id` into both the `[[d1_databases]]` and `[env.preview.[[d1_databases]]]` blocks in `worker/wrangler.toml`. Repeat for a preview DB if you want one.

2. **Create the R2 bucket.**
   ```bash
   wrangler r2 bucket create crosspost-media
   ```

3. **Create the Queue.**
   ```bash
   wrangler queues create crosspost-publish
   wrangler queues create crosspost-publish-dlq
   ```

4. **Run migrations.**
   ```bash
   npm run db:migrate:local   -w @crosspost/worker   # for wrangler dev
   npm run db:migrate:remote  -w @crosspost/worker   # against production
   ```

## Platform setup

### Mastodon
You need an access token for your own account.

1. Log in to your Mastodon instance in a browser.
2. Settings → Development → New Application.
3. Scopes required: `read:accounts`, `read:statuses`, `write:statuses`, `write:media`.
4. Save, then copy the "Your access token" value.

```bash
wrangler secret put MASTODON_INSTANCE_URL   # e.g. https://mastodon.social
wrangler secret put MASTODON_ACCESS_TOKEN
```

Docs: https://docs.joinmastodon.org/client/token/

### Bluesky
Use an **app password** (not your main password). Create one at: Settings → Privacy and Security → App passwords.

```bash
wrangler secret put BLUESKY_IDENTIFIER      # e.g. you.bsky.social
wrangler secret put BLUESKY_APP_PASSWORD    # the app password you just generated
# optional, defaults to https://bsky.social
wrangler secret put BLUESKY_SERVICE_URL
```

Docs: https://docs.bsky.app/docs/advanced-guides/app-passwords

### X (Twitter)
Apply for a developer account, create a project + app, then generate a bearer token with **Read and Write** user permissions. You'll also need the OAuth 1.0a consumer keys + access tokens (for publishing tweets — X v2 accepts bearer auth for reads but requires user-context auth for POSTs on some endpoints; this project uses bearer for both reads and writes via OAuth2 user context).

```bash
wrangler secret put X_BEARER_TOKEN
wrangler secret put X_CLIENT_ID
wrangler secret put X_CLIENT_SECRET
```

Set `ENABLE_X_SYNC = "true"` in `wrangler.toml` once you've confirmed polling works and the spend ceiling is configured the way you want.

Docs: https://developer.x.com/en/docs

### Blog feed (drateberry.com)
Posts auto-published from the blog to any platform are detected and skipped by loop prevention rule 3. The feed URL is configured in `wrangler.toml`:

```toml
BLOG_FEED_URL = "https://www.drateberry.com/feed.xml"
```

Change this value if your feed lives at a different path. The poller handles both RSS 2.0 and Atom.

### Admin auth
Two options; pick one.

**Cloudflare Access (recommended).** Wrap the worker URL in a Zero Trust application. The worker trusts the `CF-Access-Authenticated-User-Email` header for access decisions. No configuration needed in this repo — setup is done in the Cloudflare dashboard.

**Password fallback.** If Access is overkill, set `ADMIN_PASSWORD_HASH` to the sha256 of your chosen password and send it in the `x-admin-token` header on dashboard requests:

```bash
printf 'your-long-random-password' | shasum -a 256
wrangler secret put ADMIN_PASSWORD_HASH   # paste the hash
```

## Initial data

The worker expects a `platform_accounts` row per platform you want to sync. Seed them via a one-off SQL:

```bash
wrangler d1 execute crosspost --command="
  INSERT INTO platform_accounts (platform, account_id, handle, enabled) VALUES
    ('mastodon', '<your numeric id>', '<your handle>', 1),
    ('bluesky',  '<your did>',        '<you.bsky.social>', 1),
    ('x',        '<your numeric id>', '<yourhandle>',   1);
"
```

- Mastodon numeric `account_id` is visible in the URL of your profile's JSON (`/api/v1/accounts/lookup?acct=you`).
- Bluesky `account_id` is your DID (starts with `did:plc:…`). Resolve via `com.atproto.identity.resolveHandle`.
- X numeric `account_id` comes from `GET /2/users/by/username/:handle`.

## Deployment

```bash
# Worker
cd worker
npm run deploy

# Dashboard (Cloudflare Pages)
cd ../web
npx wrangler pages deploy .next --project-name=crosspost
```

Set `WORKER_URL` (or `NEXT_PUBLIC_WORKER_URL`) on the Pages project to the deployed worker URL.

## Monitoring

- `wrangler tail -w crosspost` — live worker logs.
- `/logs` on the dashboard — last 500 sync events from D1.
- The home page shows current month's X spend against the ceiling.

## Build order

Phase 1 (Mastodon ↔ Bluesky text) is what ships on first deploy. Media, OG cards, thread splitting, and X sync are each turned on via the appropriate settings + secrets once ready. See [`docs/architecture.md`](./docs/architecture.md) for the full phased plan.

## License

MIT. See [`LICENSE`](./LICENSE).
