import type { PublishJob } from "@crosspost/shared";
import type { Env } from "../env.js";
import { Db } from "../lib/db.js";
import { publishToMastodon } from "../publishers/mastodon.js";
import { publishToBluesky } from "../publishers/bluesky.js";
import { publishToX } from "../publishers/x.js";

/**
 * Queue consumer. For each PublishJob:
 *   - Load the origin post + pending mirror row.
 *   - Call the platform publisher (handles thread splitting + idempotency).
 *   - On success: write platform_post_id / platform_url and mark published.
 *   - On failure: mark failed + msg.retry() so Cloudflare Queues retries
 *     with exponential backoff, up to the configured max attempts.
 */
export async function handlePublishBatch(
  batch: MessageBatch<PublishJob>,
  env: Env,
): Promise<void> {
  const db = new Db(env.DB);

  for (const msg of batch.messages) {
    const job = msg.body;
    const startedAt = Date.now();
    try {
      const post = await db.getPost(job.post_id);
      if (!post) {
        await db.logEvent("warn", `publish: post ${job.post_id} not found; acking`, {
          platform: job.target,
        });
        msg.ack();
        continue;
      }
      const mirror = await db.getMirror(job.post_id, job.target);
      if (!mirror) {
        await db.logEvent("warn", `publish: mirror missing ${job.post_id}→${job.target}`);
        msg.ack();
        continue;
      }
      if (mirror.status === "published" && mirror.platform_post_id) {
        msg.ack();
        continue;
      }

      let result;
      switch (job.target) {
        case "mastodon": {
          const acct = await db.getPlatformAccount("mastodon");
          result = await publishToMastodon(env, {
            post_id: job.post_id,
            text: post.normalized_text,
            max_chars: acct?.max_chars ?? null,
          });
          break;
        }
        case "bluesky":
          result = await publishToBluesky(env, {
            post_id: job.post_id,
            text: post.normalized_text,
          });
          break;
        case "x":
          result = await publishToX(env, {
            post_id: job.post_id,
            text: post.normalized_text,
          });
          break;
      }

      await db.updateMirrorStatus(mirror.id, {
        status: "published",
        platform_post_id: result.platform_post_id,
        platform_url: result.platform_url,
        attempted_at: startedAt,
        published_at: Date.now(),
      });
      await db.logEvent("info", `published to ${job.target}: ${result.platform_url}`, {
        platform: job.target,
        post_id: job.post_id,
      });
      msg.ack();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.logEvent("error", `publish ${job.target} failed: ${message}`, {
        platform: job.target,
        post_id: job.post_id,
      });
      const mirror = await db.getMirror(job.post_id, job.target);
      if (mirror) {
        await db.updateMirrorStatus(mirror.id, {
          status: "failed",
          error: message,
          attempted_at: startedAt,
        });
      }
      msg.retry({ delaySeconds: Math.min(60 * 2 ** job.attempt, 900) });
    }
  }
}
