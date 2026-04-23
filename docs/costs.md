# X API cost math

## What we're billed for

Crosspost only reads **your own tweets** via `GET /2/users/:id/tweets`. Under X's current "Owned Reads" pricing, each tweet returned in the `data` array of a response counts as one billable unit at $0.001 per unit, with the following dedup rule: requests for the same tweet ID within a rolling 24-hour UTC window are only charged once.

> **Verify before shipping to production.** X's pricing has changed multiple times. Before enabling `ENABLE_X_SYNC = "true"`, cross-check the current rate on the X developer portal and the dev community forum. Update `X_OWNED_READ_PRICE_USD` in `shared/src/constants.ts` if the number has changed.

## What we're NOT billed for (on top of owned-reads)

- **Posting tweets** — creating a tweet via `POST /2/tweets` is not charged per-tweet on any current tier (rate-limited, not priced).
- **Reading other people's posts** — we don't do this, so it's moot.
- **Mastodon and Bluesky reads/writes** — both APIs are free for self-owned access at the limits we use.

## Expected spend for a single user

At 5-minute polling with `since_id`:

- A typical user posts 0–5 new tweets per 5-minute window. Most windows return `data: []`.
- Even on a heavy day (say, 20 tweets in 24 hours), the daily cost is about 20 × $0.001 = $0.02. Monthly: ~$0.60.
- The 24h dedup rule means that "same tweet returned across multiple polls" doesn't compound the cost — it just means poll overhead, not API spend.

**Rough envelope for a normal single user:** $0.15–$1.00/month.

## How we track spend

Every call to `GET /2/users/:id/tweets` that returns N tweets writes a row into `api_usage` with `unit_count = N` and `estimated_cost_usd = N × X_OWNED_READ_PRICE_USD`. The dashboard sums this table for the current month and compares against `settings.x_monthly_ceiling_usd` (default $5).

> **Caveat:** our estimate doesn't account for X's 24h dedup window — it's an **upper bound**. If you poll the same tweet 3 times in a day because it took 3 poll cycles to get published to targets, we'll record it 3 times but X will only charge once. That means actual spend is usually lower than our estimate, which is the safe direction for a ceiling.

## The ceiling

`settings.x_monthly_ceiling_usd` (default `5`) is a hard cap. `isXReadingPaused()` returns `true` when the month's tracked spend reaches the ceiling, and the X poller exits early with a warning event. Reads resume automatically at the start of the next month (when the `month` column used in `api_usage` rolls over), or immediately if you edit the setting higher or toggle `x_reads_paused` off from the dashboard.

## Tuning guidance

- **If your actual spend is well under the ceiling and you want faster sync:** nothing to tune on the cost side. Poll cadence is set by the cron in `wrangler.toml`.
- **If your actual spend is approaching the ceiling:** either raise the ceiling (if you're comfortable with it) or lengthen the poll cadence. `*/10 * * * *` halves the number of polls, which roughly halves the number of billable reads on days when you post a lot.
- **If you want to stop paying X entirely:** set `ENABLE_X_SYNC = "false"` in `wrangler.toml`. The worker will stop polling X and stop publishing to X, while continuing to sync between Mastodon and Bluesky at no cost.
