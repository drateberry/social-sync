# Social Sync architecture

This doc exists primarily so that six months from now, when you (or anyone) need to re-verify the loop-prevention logic, you can read the reasoning in prose instead of reverse-engineering it from the SQL.

## Runtime at a glance

- **Cloudflare Worker** triggered by a `*/5 * * * *` cron. Each tick:
  1. Refreshes `blog_posts` from the configured RSS/Atom feed, if `BLOG_FEED_URL` is set.
  2. Polls each enabled source platform (`mastodon`, `bluesky`, `x`) for new posts since `platform_accounts.last_seen_id`.
  3. For each post, runs the loop-prevention decision (below). Accepted posts become new origins; their media is cached in **R2**; publish jobs are enqueued on **Cloudflare Queues**.
- **Queue consumer** runs inside the same worker. For each publish job it reads the origin, calls the target platform's publish API, and records the result in `post_mirrors`. Failures are retried with exponential backoff up to 5 times, then land in a DLQ.
- **D1** holds all state: `posts`, `post_mirrors`, `platform_accounts`, `blog_posts`, `og_cache`, `api_usage`, `sync_events`, `settings`.
- **Next.js dashboard** on Cloudflare Pages talks to the worker via its `/api/*` endpoints. Auth is either Cloudflare Access or a `x-admin-token` bearer matching `ADMIN_PASSWORD_HASH`.

## Why polling, not streaming

Workers are request-response and can't hold long-lived connections. Mastodon's streaming API and Bluesky's firehose both require persistent connections, which would force us into a second runtime (a Node process, a Durable Object with a renewable connection, etc.) just for two of three platforms. A 5-minute poll across all three is simpler, matches the 15-minute SLA with room for 3 retry opportunities, and keeps the entire system inside one deployment artifact.

## Loop prevention — the hard part

The failure mode we're preventing: a post syncs from X → Mastodon. The next Mastodon poll sees that post and tries to sync it back to X (and Bluesky), starting an infinite loop.

### Data model

```
posts(id, origin_platform, origin_post_id, content_hash, normalized_text, media_json, created_at)
  └─ post_mirrors(post_id, platform, platform_post_id, status, idempotency_key, …)
```

A row in `posts` is an **origin** — a post the user wrote somewhere, that we are responsible for fanning out. A row in `post_mirrors` is a **mirror** — a copy of an origin that we published to another platform.

`post_mirrors` has two unique constraints that do a lot of heavy lifting:

- `UNIQUE(platform, platform_post_id)` — the identifier the platform assigned when we published. Any poller that sees this ID again knows it's one of ours.
- `UNIQUE(platform, idempotency_key)` — the deterministic key we pre-compute from `(post_id, target)`. Used to reserve a pending row *before* we call the publish API, so even if we crash mid-publish we have a record of our intent.

### The decision procedure

When a poller returns a post, we apply these rules in order. The **first rule that matches wins** — that's what keeps the logic airtight.

1. **`#nosync` tag** — if the text contains `#nosync` as a whole tag (case-insensitive, boundary-delimited so `#nosyncing` doesn't match), skip immediately. This is the user's manual escape hatch and takes precedence over everything else.
2. **Unsupported kind** — replies, reposts/boosts/reblogs, and quote posts are skipped. v1 scope is top-level posts only.
3. **Rule 1 (mirror):** does `(post_mirrors.platform, post_mirrors.platform_post_id)` already contain this post? If yes, this post was created by us. Skip.
4. **Rule 2 (origin seen):** does `(posts.origin_platform, posts.origin_post_id)` already contain this post? If yes, we already ingested this as an origin on a previous run (e.g. a poller overlap or a manual re-run). Skip.
5. **Rule 3 (blog):** does the post reference a URL in `blog_posts` whose `published_at` is within 2 hours of `post.created_at`? If yes, this is almost certainly the blog's auto-poster putting the same announcement on all three networks independently — we don't want to re-amplify it. Skip. Tracking parameters (`utm_*`, `ref`, `fbclid`, etc.) are stripped before matching.
6. **Rule 4 (content-hash safety net):** is there a `posts.content_hash` that matches, with `created_at` within the last 30 minutes? Skip.
7. Otherwise: **accept** — insert into `posts`, cache media in R2, and enqueue publish jobs for each enabled target.

### Why rule 4 is more important than "belt and suspenders"

Rules 1 and 2 are airtight in the happy path. Rule 4 exists for the failure mode that breaks them:

> **The publisher calls the target platform's API successfully but crashes before writing `platform_post_id` into `post_mirrors`.**

When the next poll of that target sees the post, rule 1 doesn't fire (no mirror row was written) and rule 2 doesn't fire (it's not an origin on this platform). Rule 4 catches it because the normalized text + media hash match a row in `posts` from a few minutes ago.

To keep rule 4 as the safety net rather than the primary defense, publishers use **idempotency keys**:

- **Mastodon** — uses the native `Idempotency-Key` header. Retrying with the same key returns the same status ID without creating a duplicate.
- **Bluesky** — uses a deterministic `rkey` in `com.atproto.repo.putRecord`. `putRecord` is idempotent on the rkey, so retries no-op cleanly.
- **X** — v2 doesn't accept an idempotency header as of this writing. Before publishing, the orchestrator pre-inserts a `post_mirrors` row keyed on `(platform, idempotency_key)`. The `UNIQUE` constraint on that tuple means a retry on the same `post_id→target` pair hits the same row; our code writes the platform post ID once the API call returns. A crash between "API succeeded" and "DB updated" is caught by rule 4 on the next inbound poll.

### Content-hash normalization

Rule 4 only works if the same logical post produces the same hash regardless of which platform returned it. `computeContentHash` normalizes:

- **Text:** lowercases, strips `@mentions` (Mastodon expands `@user@host.com`, Bluesky uses DIDs, X wraps in entities), strips URLs (X rewrites to t.co wrappers), collapses whitespace.
- **Media:** keyed by the **sha256 of the bytes** after we download the media into R2. Media URLs from the platform differ across hops, but the image/video payload is the same.

The hash is insensitive to media ordering (we sort before hashing) because it should be — the same set of images in a different order is still the same logical post.

## Blog exclusion (rule 3)

If you run a blog with an auto-post-to-socials automation elsewhere, you don't want Social Sync to re-amplify those announcements (since the blog already posted them to all three networks). But you *do* want manual posts that happen to link to the blog to sync normally.

Implementation: when `BLOG_FEED_URL` is set, a small RSS/Atom poller populates `blog_posts` every tick. Rule 3 matches a social post against `blog_posts` only when both are true: (a) the post contains the blog URL (canonicalized), and (b) the post was published within 2h of the blog entry. Manual mentions of the blog (days later, or with substantial surrounding text) sail through. If `BLOG_FEED_URL` is empty, rule 3 is a no-op.

## Text transformation and platform specifics

- **Thread splitting.** Over-limit posts are split at the last whitespace before the target limit, with numbered `🧵 N/M` suffixes. Subsequent parts are replies to the prior part on all platforms. Limits: X 280, Mastodon 500 (or instance `configuration.statuses.max_characters`), Bluesky 300 **graphemes** (measured with `Intl.Segmenter` so family emoji count as one).
- **Link preview cards.** X and Mastodon auto-generate previews from URLs in the body. Bluesky does not — we parse OpenGraph meta tags from the first URL in the post, upload the `og:image` as a blob, and attach an `app.bsky.embed.external` record. OG data is cached in D1 for 7 days. OG fetch failures are non-fatal: the post ships without a card.
- **Images + alt text.** 4-image max per platform. Alt text is preserved verbatim; we never synthesize.
- **Videos.** Detected and logged; skipped on v1.

## Cost tracking

`api_usage` records a row per X API call with the estimated USD cost (see `docs/costs.md`). The dashboard sums `api_usage.estimated_cost_usd` for the current month and compares against the `x_monthly_ceiling_usd` setting. When the ceiling is hit, `isXReadingPaused()` short-circuits the X poller until the month rolls over or the user manually clears `x_reads_paused`.

## Known holes / future work

- **Rule 4 window tuning.** 30 minutes is a guess. If a loop slips through, widen the window. If false-positive skips pile up (identical intentional re-posts), narrow it.
- **X idempotency on publish.** If X adds `Idempotency-Key` support later, wire it in at `worker/src/publishers/x.ts` and demote rule 4 back to true belt-and-suspenders for X the way it already is for the other two.
- **Client/application signal.** Mastodon exposes `application.name` on each status. If the blog auto-poster registers a distinct application name, we can use it as a faster signal than URL+time matching. Worth turning on after one real run confirms the name.
- **Backfill.** The `last_seen_id`-based poller never re-fetches history. An admin "backfill N days" action is listed in the product spec but not yet implemented.
