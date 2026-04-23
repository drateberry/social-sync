import type {
  PostRow,
  PostMirrorRow,
  PlatformAccountRow,
  BlogPostRow,
  Platform,
  PostStatus,
  SkipReason,
  OgCacheRow,
  ApiUsageRow,
  SettingsRow,
} from "@crosspost/shared";

export class Db {
  constructor(private readonly d1: D1Database) {}

  async getPlatformAccount(platform: Platform): Promise<PlatformAccountRow | null> {
    return this.d1
      .prepare("SELECT * FROM platform_accounts WHERE platform = ?")
      .bind(platform)
      .first<PlatformAccountRow>();
  }

  async upsertPlatformAccount(row: PlatformAccountRow): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO platform_accounts
         (platform, account_id, handle, last_seen_id, last_polled_at, instance_url, max_chars, enabled)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
         ON CONFLICT(platform) DO UPDATE SET
           account_id=excluded.account_id,
           handle=excluded.handle,
           instance_url=excluded.instance_url,
           max_chars=excluded.max_chars,
           enabled=excluded.enabled`,
      )
      .bind(
        row.platform,
        row.account_id,
        row.handle,
        row.last_seen_id,
        row.last_polled_at,
        row.instance_url,
        row.max_chars,
        row.enabled,
      )
      .run();
  }

  async updateLastSeen(platform: Platform, lastSeenId: string, polledAt: number): Promise<void> {
    await this.d1
      .prepare(
        "UPDATE platform_accounts SET last_seen_id = ?1, last_polled_at = ?2 WHERE platform = ?3",
      )
      .bind(lastSeenId, polledAt, platform)
      .run();
  }

  async findPostByOrigin(platform: Platform, originPostId: string): Promise<PostRow | null> {
    return this.d1
      .prepare("SELECT * FROM posts WHERE origin_platform = ?1 AND origin_post_id = ?2")
      .bind(platform, originPostId)
      .first<PostRow>();
  }

  async findMirrorByPlatformPostId(
    platform: Platform,
    platformPostId: string,
  ): Promise<PostMirrorRow | null> {
    return this.d1
      .prepare("SELECT * FROM post_mirrors WHERE platform = ?1 AND platform_post_id = ?2")
      .bind(platform, platformPostId)
      .first<PostMirrorRow>();
  }

  async findRecentContentHashMatch(
    contentHash: string,
    sinceMs: number,
  ): Promise<PostRow | null> {
    return this.d1
      .prepare(
        "SELECT * FROM posts WHERE content_hash = ?1 AND created_at >= ?2 ORDER BY created_at DESC LIMIT 1",
      )
      .bind(contentHash, sinceMs)
      .first<PostRow>();
  }

  async insertPost(row: PostRow): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO posts (id, origin_platform, origin_post_id, origin_url, content_hash, normalized_text, media_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
      )
      .bind(
        row.id,
        row.origin_platform,
        row.origin_post_id,
        row.origin_url,
        row.content_hash,
        row.normalized_text,
        row.media_json,
        row.created_at,
      )
      .run();
  }

  async getPost(id: string): Promise<PostRow | null> {
    return this.d1.prepare("SELECT * FROM posts WHERE id = ?").bind(id).first<PostRow>();
  }

  async getMirror(postId: string, platform: Platform): Promise<PostMirrorRow | null> {
    return this.d1
      .prepare("SELECT * FROM post_mirrors WHERE post_id = ?1 AND platform = ?2")
      .bind(postId, platform)
      .first<PostMirrorRow>();
  }

  async listRecentPosts(limit = 100): Promise<PostRow[]> {
    const res = await this.d1
      .prepare("SELECT * FROM posts ORDER BY created_at DESC LIMIT ?")
      .bind(limit)
      .all<PostRow>();
    return res.results ?? [];
  }

  async listMirrorsForPosts(postIds: string[]): Promise<PostMirrorRow[]> {
    if (postIds.length === 0) return [];
    const placeholders = postIds.map(() => "?").join(",");
    const res = await this.d1
      .prepare(`SELECT * FROM post_mirrors WHERE post_id IN (${placeholders})`)
      .bind(...postIds)
      .all<PostMirrorRow>();
    return res.results ?? [];
  }

  async insertMirror(row: Omit<PostMirrorRow, "id">): Promise<number> {
    const res = await this.d1
      .prepare(
        `INSERT INTO post_mirrors
         (post_id, platform, platform_post_id, platform_url, status, idempotency_key, skip_reason, error, attempted_at, published_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`,
      )
      .bind(
        row.post_id,
        row.platform,
        row.platform_post_id,
        row.platform_url,
        row.status,
        row.idempotency_key,
        row.skip_reason,
        row.error,
        row.attempted_at,
        row.published_at,
      )
      .run();
    return res.meta.last_row_id as number;
  }

  async updateMirrorStatus(
    id: number,
    patch: {
      status: PostStatus;
      platform_post_id?: string | null;
      platform_url?: string | null;
      skip_reason?: SkipReason | null;
      error?: string | null;
      attempted_at?: number | null;
      published_at?: number | null;
    },
  ): Promise<void> {
    await this.d1
      .prepare(
        `UPDATE post_mirrors SET
           status = ?1,
           platform_post_id = COALESCE(?2, platform_post_id),
           platform_url = COALESCE(?3, platform_url),
           skip_reason = COALESCE(?4, skip_reason),
           error = COALESCE(?5, error),
           attempted_at = COALESCE(?6, attempted_at),
           published_at = COALESCE(?7, published_at)
         WHERE id = ?8`,
      )
      .bind(
        patch.status,
        patch.platform_post_id ?? null,
        patch.platform_url ?? null,
        patch.skip_reason ?? null,
        patch.error ?? null,
        patch.attempted_at ?? null,
        patch.published_at ?? null,
        id,
      )
      .run();
  }

  async findBlogPostByUrl(url: string): Promise<BlogPostRow | null> {
    return this.d1
      .prepare("SELECT * FROM blog_posts WHERE url = ?")
      .bind(url)
      .first<BlogPostRow>();
  }

  async upsertBlogPost(row: BlogPostRow): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO blog_posts (url, title, published_at, discovered_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(url) DO UPDATE SET title=excluded.title, published_at=excluded.published_at`,
      )
      .bind(row.url, row.title, row.published_at, row.discovered_at)
      .run();
  }

  async getOgCache(url: string): Promise<OgCacheRow | null> {
    return this.d1.prepare("SELECT * FROM og_cache WHERE url = ?").bind(url).first<OgCacheRow>();
  }

  async upsertOgCache(row: OgCacheRow): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO og_cache (url, title, description, image_url, fetched_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(url) DO UPDATE SET
           title=excluded.title, description=excluded.description,
           image_url=excluded.image_url, fetched_at=excluded.fetched_at`,
      )
      .bind(row.url, row.title, row.description, row.image_url, row.fetched_at)
      .run();
  }

  async recordApiUsage(
    platform: Platform,
    endpoint: string,
    unitCount: number,
    estimatedCostUsd: number,
    occurredAt: number,
  ): Promise<void> {
    const month = new Date(occurredAt).toISOString().slice(0, 7);
    await this.d1
      .prepare(
        `INSERT INTO api_usage (platform, endpoint, unit_count, estimated_cost_usd, occurred_at, month)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(platform, endpoint, unitCount, estimatedCostUsd, occurredAt, month)
      .run();
  }

  async getMonthlySpend(platform: Platform, month: string): Promise<number> {
    const res = await this.d1
      .prepare(
        "SELECT COALESCE(SUM(estimated_cost_usd), 0) as total FROM api_usage WHERE platform = ?1 AND month = ?2",
      )
      .bind(platform, month)
      .first<{ total: number }>();
    return res?.total ?? 0;
  }

  async getSetting(key: string): Promise<string | null> {
    const res = await this.d1
      .prepare("SELECT value FROM settings WHERE key = ?")
      .bind(key)
      .first<{ value: string }>();
    return res?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`,
      )
      .bind(key, value, Date.now())
      .run();
  }

  async getAllSettings(): Promise<SettingsRow[]> {
    const res = await this.d1.prepare("SELECT * FROM settings").all<SettingsRow>();
    return res.results ?? [];
  }

  async logEvent(
    level: "info" | "warn" | "error",
    message: string,
    opts: { platform?: Platform; post_id?: string; data?: unknown } = {},
  ): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO sync_events (level, platform, post_id, message, data, occurred_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      )
      .bind(
        level,
        opts.platform ?? null,
        opts.post_id ?? null,
        message,
        opts.data !== undefined ? JSON.stringify(opts.data) : null,
        Date.now(),
      )
      .run();
  }

  async recentEvents(limit = 500): Promise<unknown[]> {
    const res = await this.d1
      .prepare("SELECT * FROM sync_events ORDER BY occurred_at DESC LIMIT ?")
      .bind(limit)
      .all();
    return res.results ?? [];
  }
}
