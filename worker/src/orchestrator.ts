import type { NormalizedPost, Platform, PublishJob, StoredMedia } from "@social-sync/shared";
import type { Env } from "./env.js";
import { Db } from "./lib/db.js";
import { computeContentHash, sha256Hex } from "./lib/content-hash.js";
import { decideSyncAction } from "./lib/loop-prevention.js";
import { cacheMedia } from "./lib/media.js";
import { idempotencyKey } from "./lib/idempotency.js";
import { pollMastodon } from "./pollers/mastodon.js";
import { pollBluesky } from "./pollers/bluesky.js";
import { pollX } from "./pollers/x.js";
import { pollBlogFeed } from "./pollers/blog.js";

const TARGETS_BY_ORIGIN: Record<Platform, Platform[]> = {
  x: ["mastodon", "bluesky"],
  mastodon: ["bluesky", "x"],
  bluesky: ["mastodon", "x"],
};

/**
 * Run every scheduled tick:
 *  1. Refresh blog_posts from the configured RSS/Atom feed.
 *  2. Poll each enabled source platform for new posts.
 *  3. For each post, apply loop-prevention. Accepted posts are persisted
 *     as an origin, their media cached in R2, and a publish job enqueued
 *     for each target platform per per-pair settings.
 */
export async function runIngestCycle(env: Env, ctx: ExecutionContext): Promise<void> {
  const db = new Db(env.DB);

  try {
    await pollBlogFeed(env, db);
  } catch (err) {
    await db.logEvent("warn", `blog feed poll error: ${errMsg(err)}`);
  }

  const sources: Array<[Platform, () => Promise<NormalizedPost[]>]> = [
    ["mastodon", () => pollMastodon(env, db)],
    ["bluesky", () => pollBluesky(env, db)],
    ["x", () => pollX(env, db)],
  ];

  for (const [platform, poll] of sources) {
    try {
      const posts = await poll();
      for (const post of posts) {
        await ingestOne(env, db, post, ctx);
      }
    } catch (err) {
      await db.logEvent("error", `${platform} poll error: ${errMsg(err)}`, { platform });
    }
  }
}

async function ingestOne(
  env: Env,
  db: Db,
  post: NormalizedPost,
  _ctx: ExecutionContext,
): Promise<void> {
  const now = Date.now();
  const postId = crypto.randomUUID();

  // Cache media and compute byte-level hashes for content-hash stability.
  const stored: StoredMedia[] = [];
  try {
    for (let i = 0; i < post.media.length; i++) {
      const m = post.media[i]!;
      if (m.kind === "video") {
        await db.logEvent("warn", "video attachment detected; skipped (v1.1)", {
          platform: post.platform,
          post_id: postId,
        });
        continue;
      }
      const cached = await cacheMedia(env.MEDIA, postId, i, m.source_url);
      stored.push({
        kind: m.kind,
        r2_key: cached.key,
        content_type: cached.contentType,
        sha256: cached.sha256,
        alt_text: m.alt_text,
      });
    }
  } catch (err) {
    await db.logEvent("warn", `media cache error: ${errMsg(err)}`, {
      platform: post.platform,
    });
  }

  const contentHash = await computeContentHash(
    post,
    stored.map((s) => s.sha256),
  );

  const decision = await decideSyncAction(db, { post, contentHash, now });
  if (decision.action === "skip") {
    await db.logEvent("info", `skip ${post.platform}/${post.platform_post_id}: ${decision.reason}`, {
      platform: post.platform,
      data: { reason: decision.reason, detail: "detail" in decision ? decision.detail : undefined },
    });
    return;
  }

  await db.insertPost({
    id: postId,
    origin_platform: post.platform,
    origin_post_id: post.platform_post_id,
    origin_url: post.url,
    content_hash: contentHash,
    normalized_text: post.text,
    media_json: JSON.stringify(stored),
    created_at: post.created_at,
  });
  await db.logEvent("info", `new origin ${post.platform}/${post.platform_post_id}`, {
    platform: post.platform,
    post_id: postId,
  });

  // Enqueue fanout to each target platform (subject to per-pair settings).
  for (const target of TARGETS_BY_ORIGIN[post.platform]) {
    const settingKey = `sync_${post.platform}_to_${target}`;
    const enabled = (await db.getSetting(settingKey)) === "true";
    if (!enabled) {
      await db.insertMirror({
        post_id: postId,
        platform: target,
        platform_post_id: null,
        platform_url: null,
        status: "skipped",
        idempotency_key: idempotencyKey(postId, target),
        skip_reason: "origin_seen",
        error: "pair disabled in settings",
        attempted_at: now,
        published_at: null,
      });
      continue;
    }
    // Reserve a pending mirror row BEFORE publishing, keyed on the
    // idempotency_key. This is what turns mid-publish crashes into
    // benign no-ops on retry.
    try {
      await db.insertMirror({
        post_id: postId,
        platform: target,
        platform_post_id: null,
        platform_url: null,
        status: "pending",
        idempotency_key: idempotencyKey(postId, target),
        skip_reason: null,
        error: null,
        attempted_at: null,
        published_at: null,
      });
    } catch (err) {
      // Unique violation on (platform, idempotency_key) → already enqueued.
      await db.logEvent("info", `mirror already reserved: ${errMsg(err)}`, {
        platform: target,
        post_id: postId,
      });
      continue;
    }

    const job: PublishJob = { post_id: postId, target, attempt: 0 };
    await env.PUBLISH_QUEUE.send(job);
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Hash helper exposed so tests can import.
export { sha256Hex };
