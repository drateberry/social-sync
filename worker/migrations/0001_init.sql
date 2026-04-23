-- Social Sync initial schema
-- See docs/architecture.md for loop-prevention logic over these tables.

CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  origin_platform TEXT NOT NULL,
  origin_post_id TEXT NOT NULL,
  origin_url TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  normalized_text TEXT NOT NULL DEFAULT '',
  media_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  UNIQUE(origin_platform, origin_post_id)
);

CREATE INDEX idx_posts_content_hash_created ON posts(content_hash, created_at DESC);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);

CREATE TABLE post_mirrors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  platform_post_id TEXT,
  platform_url TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending','published','failed','skipped')),
  idempotency_key TEXT NOT NULL,
  skip_reason TEXT,
  error TEXT,
  attempted_at INTEGER,
  published_at INTEGER,
  UNIQUE(platform, platform_post_id),
  UNIQUE(platform, idempotency_key)
);

CREATE INDEX idx_post_mirrors_post ON post_mirrors(post_id);
CREATE INDEX idx_post_mirrors_status ON post_mirrors(status);

CREATE TABLE platform_accounts (
  platform TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  handle TEXT NOT NULL,
  last_seen_id TEXT,
  last_polled_at INTEGER,
  instance_url TEXT,
  max_chars INTEGER,
  enabled INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE blog_posts (
  url TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  discovered_at INTEGER NOT NULL
);

CREATE INDEX idx_blog_posts_published ON blog_posts(published_at DESC);

CREATE TABLE og_cache (
  url TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  image_url TEXT,
  fetched_at INTEGER NOT NULL
);

CREATE TABLE api_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  unit_count INTEGER NOT NULL DEFAULT 1,
  estimated_cost_usd REAL NOT NULL DEFAULT 0,
  occurred_at INTEGER NOT NULL,
  month TEXT NOT NULL
);

CREATE INDEX idx_api_usage_month_platform ON api_usage(month, platform);

CREATE TABLE sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL CHECK (level IN ('info','warn','error')),
  platform TEXT,
  post_id TEXT,
  message TEXT NOT NULL,
  data TEXT,
  occurred_at INTEGER NOT NULL
);

CREATE INDEX idx_sync_events_occurred ON sync_events(occurred_at DESC);
CREATE INDEX idx_sync_events_platform ON sync_events(platform, occurred_at DESC);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Defaults
INSERT INTO settings (key, value, updated_at) VALUES
  ('x_monthly_ceiling_usd', '5', strftime('%s','now') * 1000),
  ('x_reads_paused', 'false', strftime('%s','now') * 1000),
  ('nosync_tag', '#nosync', strftime('%s','now') * 1000),
  ('sync_mastodon_to_bluesky', 'true', strftime('%s','now') * 1000),
  ('sync_bluesky_to_mastodon', 'true', strftime('%s','now') * 1000),
  ('sync_x_to_mastodon', 'false', strftime('%s','now') * 1000),
  ('sync_x_to_bluesky', 'false', strftime('%s','now') * 1000),
  ('sync_mastodon_to_x', 'false', strftime('%s','now') * 1000),
  ('sync_bluesky_to_x', 'false', strftime('%s','now') * 1000);
