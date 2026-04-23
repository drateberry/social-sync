import type { PublishJob } from "@crosspost/shared";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  PUBLISH_QUEUE: Queue<PublishJob>;

  LOG_LEVEL: string;
  BLOG_FEED_URL: string;
  BLOG_HOSTNAME: string;
  ENABLE_X_SYNC: string;

  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
  X_ACCESS_TOKEN?: string;
  X_ACCESS_TOKEN_SECRET?: string;
  X_BEARER_TOKEN?: string;

  MASTODON_INSTANCE_URL?: string;
  MASTODON_ACCESS_TOKEN?: string;

  BLUESKY_SERVICE_URL?: string;
  BLUESKY_IDENTIFIER?: string;
  BLUESKY_APP_PASSWORD?: string;

  ADMIN_PASSWORD_HASH?: string;
  SESSION_SECRET?: string;
}
