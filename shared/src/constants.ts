export const PLATFORMS = ["x", "mastodon", "bluesky"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LIMITS = {
  x: { text: 280, images: 4 },
  mastodon: { text: 500, images: 4 },
  bluesky: { text: 300, images: 4 },
} as const satisfies Record<Platform, { text: number; images: number }>;

export const THREAD_SUFFIX_RESERVE = 10;

export const NOSYNC_TAG = "#nosync";

export const CONTENT_HASH_MATCH_WINDOW_MS = 30 * 60 * 1000;

export const BLOG_URL_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000;

export const X_MONTHLY_CEILING_USD_DEFAULT = 5;

export const X_OWNED_READ_PRICE_USD = 0.001;

export const OG_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const POST_STATUSES = ["pending", "published", "failed", "skipped"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const SKIP_REASONS = [
  "mirror",
  "origin_seen",
  "origin_blog",
  "content_hash_recent",
  "nosync_tag",
  "unsupported_kind",
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];
