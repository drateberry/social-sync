# Social Sync

Self-hosted cross-platform social sync for **X**, **Mastodon**, and **Bluesky**. Post to any one of them and the post fans out to the other two within ~15 minutes.

Single-tenant (one user per deployment), runs on Cloudflare Workers + D1 + R2 + Queues. MIT-licensed.

For the design rationale, especially loop prevention, see [`docs/architecture.md`](./docs/architecture.md). For X API cost tuning, see [`docs/costs.md`](./docs/costs.md).

---

## Repo layout

```
/shared      TypeScript types shared between worker and web
/worker      Cloudflare Worker (pollers, publishers, orchestrator, queue consumer, admin API)
  /migrations  D1 schema migrations + seed template
  /tests       Vitest unit tests (loop-prevention canary lives here)
/web         Next.js (App Router) dashboard, deployed as a Cloudflare Worker via OpenNext
/docs        Architecture + cost notes
```

## Quick start (fresh clone)

Requirements: Node 20+, a Cloudflare account, `wrangler` (installed as a worker devDependency — call via `npx wrangler` or the workspace scripts).

```bash
git clone <repo-url> social-sync
cd social-sync
npm install
npm run test          # 38 tests, all local — no Cloudflare setup required yet
```

If tests pass, the code is healthy. Now set up Cloudflare.

### 1. Create Cloudflare resources

```bash
cd worker
npx wrangler login

npx wrangler d1 create social-sync
#   → copy the returned database_id into worker/wrangler.toml
#     (the top-level [[d1_databases]] block)

npx wrangler r2 bucket create social-sync-media
npx wrangler queues create social-sync-publish
npx wrangler queues create social-sync-publish-dlq
```

Open `worker/wrangler.toml` and paste the D1 `database_id` into the empty `database_id = ""` field. If you also want a preview environment, repeat for `social-sync-preview`, `social-sync-media-preview`, and `social-sync-publish-preview` and fill the `[env.preview.*]` block.

### 2. Run migrations

```bash
# from worker/
npm run db:migrate:local    # for `wrangler dev`
npm run db:migrate:remote   # for the deployed worker
```

### 3. Configure secrets

Copy the template and fill in the values you need:

```bash
# from worker/
cp .dev.vars.example .dev.vars   # for local `wrangler dev`
```

For production, set each as a Cloudflare secret instead (values below, only the platforms you want to sync are required):

```bash
# Mastodon (required for Mastodon sync)
npx wrangler secret put MASTODON_INSTANCE_URL
npx wrangler secret put MASTODON_ACCESS_TOKEN

# Bluesky (required for Bluesky sync)
npx wrangler secret put BLUESKY_IDENTIFIER
npx wrangler secret put BLUESKY_APP_PASSWORD

# X (optional — only if you set ENABLE_X_SYNC="true" in wrangler.toml)
npx wrangler secret put X_BEARER_TOKEN
npx wrangler secret put X_CLIENT_ID
npx wrangler secret put X_CLIENT_SECRET

# Admin auth fallback (skip if using Cloudflare Access — see Admin section)
npx wrangler secret put ADMIN_PASSWORD_HASH
```

Platform-specific instructions for obtaining these values are in the [Platform setup](#platform-setup) section below.

### 4. Seed your platform accounts

```bash
# from worker/
cp migrations/seed.sql.example migrations/seed.sql
# edit seed.sql, fill in your handles/IDs, then:
npx wrangler d1 execute social-sync --file=./migrations/seed.sql                # local
npx wrangler d1 execute social-sync --file=./migrations/seed.sql --remote       # production
```

The seed.sql file is gitignored, so your IDs stay out of version control.

### 5. Optional: configure blog exclusion

If you auto-post from a personal blog to all three networks via some other automation, set `BLOG_FEED_URL` in `worker/wrangler.toml` to the RSS/Atom feed URL of that blog. Social Sync will skip any social post that links to a blog entry published in the last 2 hours — preventing re-amplification of your own cross-network announcements.

Leave `BLOG_FEED_URL = ""` to disable this feature entirely.

### 6. Deploy

Deploy the worker:

```bash
cd worker && npx wrangler deploy
```

Deploy the dashboard. It's a Next.js App Router app with server components, compiled to a Cloudflare Worker (with static assets) via the [OpenNext Cloudflare adapter](https://opennext.js.org/cloudflare):

```bash
cd ../web
cp .env.example .env.local                  # then edit WORKER_URL to the deployed worker URL
npm run cf:deploy                           # opennextjs-cloudflare build + deploy
```

The dashboard deploys as a separate Worker named `social-sync-web` (see `web/wrangler.toml`) — distinct from the API worker deployed in the first step. You can preview locally with `npm run cf:preview`.

`WORKER_URL` is baked into the build (see `next.config.mjs`), so it must be set in `.env.local` **before** you run `cf:deploy`. If the API worker URL changes, rebuild and redeploy — setting env vars in the Cloudflare dashboard after the fact will not affect the already-built bundle.

---

## Platform setup

### Mastodon

1. Log in to your Mastodon instance.
2. Settings → Development → New Application.
3. Scopes: `read:accounts`, `read:statuses`, `write:statuses`, `write:media`.
4. Save, then copy "Your access token".

Values:
- `MASTODON_INSTANCE_URL` — e.g. `https://mastodon.social`
- `MASTODON_ACCESS_TOKEN` — from the app page

Docs: https://docs.joinmastodon.org/client/token/

### Bluesky

Use an **app password**, not your main password.

1. Settings → Privacy and Security → App passwords → Add.
2. Copy the generated password.

Values:
- `BLUESKY_IDENTIFIER` — e.g. `you.bsky.social`
- `BLUESKY_APP_PASSWORD` — the app password
- `BLUESKY_SERVICE_URL` — optional, defaults to `https://bsky.social`

Docs: https://docs.bsky.app/docs/advanced-guides/app-passwords

### X (Twitter)

Requires a developer account and an app with **Read and Write** user permissions. X's API has per-call pricing — **read [`docs/costs.md`](./docs/costs.md) before enabling.** Keep `ENABLE_X_SYNC = "false"` in `wrangler.toml` until you've confirmed the spend ceiling is set the way you want.

Values:
- `X_BEARER_TOKEN`, `X_CLIENT_ID`, `X_CLIENT_SECRET`

Docs: https://developer.x.com/en/docs

## Admin auth

Two options:

**Cloudflare Access (recommended).** Wrap the deployed worker URL in a Zero Trust Access application. The worker trusts the `CF-Access-Authenticated-User-Email` header that Access injects. Nothing to configure in this repo.

**Password fallback.** If you'd rather not set up Access:

```bash
printf 'your-long-random-password' | shasum -a 256
npx wrangler secret put ADMIN_PASSWORD_HASH   # paste the hex digest
```

The dashboard then sends this password in the `x-admin-token` request header.

## Local development

```bash
npm install
npm run test          # all workspaces, ~1s
npm run typecheck     # all workspaces
npm run worker:dev    # wrangler dev on :8787
npm run web:dev       # next dev on :3000
```

The canary test (`worker/tests/loop-prevention.test.ts`) is the one test you must never let regress — it covers the X→Mastodon→poll-Mastodon scenario and each loop-prevention rule individually. If this test fails, stop and investigate.

## Monitoring

- `npx wrangler tail --name social-sync` — live worker logs.
- `/logs` on the dashboard — last 500 sync events from D1.
- `/` on the dashboard — current month's X spend vs. ceiling.

## Contributing

Pull requests welcome. Two ground rules:

1. The loop-prevention canary test must stay green. If you touch any of the rules in `worker/src/lib/loop-prevention.ts` or the surrounding infrastructure, add a regression test for the scenario you're changing.
2. If you add platform-specific behavior (new field, new limit, new quirk), add a short note to `docs/architecture.md` under "Text transformation and platform specifics" so the reasoning survives future refactors.

## License

MIT. See [`LICENSE`](./LICENSE).
