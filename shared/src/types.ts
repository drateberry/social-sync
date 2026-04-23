import type { Platform, PostStatus, SkipReason } from "./constants.js";

export interface PostRow {
  id: string;
  origin_platform: Platform;
  origin_post_id: string;
  origin_url: string;
  content_hash: string;
  normalized_text: string;
  media_json: string;
  created_at: number;
}

export interface StoredMedia {
  kind: "image" | "video" | "gif";
  r2_key: string;
  content_type: string;
  sha256: string;
  alt_text: string | null;
}

export interface PostMirrorRow {
  id: number;
  post_id: string;
  platform: Platform;
  platform_post_id: string | null;
  platform_url: string | null;
  status: PostStatus;
  idempotency_key: string;
  skip_reason: SkipReason | null;
  error: string | null;
  attempted_at: number | null;
  published_at: number | null;
}

export interface PlatformAccountRow {
  platform: Platform;
  account_id: string;
  handle: string;
  last_seen_id: string | null;
  last_polled_at: number | null;
  instance_url: string | null;
  max_chars: number | null;
  enabled: 0 | 1;
}

export interface BlogPostRow {
  url: string;
  title: string;
  published_at: number;
  discovered_at: number;
}

export interface OgCacheRow {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  fetched_at: number;
}

export interface ApiUsageRow {
  id: number;
  platform: Platform;
  endpoint: string;
  unit_count: number;
  estimated_cost_usd: number;
  occurred_at: number;
  month: string;
}

export interface SyncEventRow {
  id: number;
  level: "info" | "warn" | "error";
  platform: Platform | null;
  post_id: string | null;
  message: string;
  data: string | null;
  occurred_at: number;
}

export interface SettingsRow {
  key: string;
  value: string;
  updated_at: number;
}

export interface NormalizedPost {
  platform: Platform;
  platform_post_id: string;
  url: string;
  created_at: number;
  text: string;
  media: NormalizedMedia[];
  urls_in_text: string[];
  is_reply: boolean;
  is_repost: boolean;
  is_quote: boolean;
  raw: unknown;
}

export interface NormalizedMedia {
  kind: "image" | "video" | "gif";
  source_url: string;
  alt_text: string | null;
  width: number | null;
  height: number | null;
}

export interface PublishJob {
  post_id: string;
  target: Platform;
  attempt: number;
}

export interface PublishResult {
  platform_post_id: string;
  platform_url: string;
}
