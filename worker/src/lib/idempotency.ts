import type { Platform } from "@crosspost/shared";

/**
 * Deterministic idempotency key derived from our internal post_id and
 * target platform. Used:
 *   - Mastodon: as Idempotency-Key header (native dedup on the server side)
 *   - Bluesky: as the suffix of the record's rkey (deterministic record key)
 *   - X: sent with the publish request when/if X adds support; otherwise
 *     we rely on the pending-mirror row keyed on this value to catch
 *     same-input retries at our side.
 */
export function idempotencyKey(postId: string, target: Platform): string {
  return `${postId}:${target}`;
}

/**
 * Bluesky requires rkeys to match [A-Za-z0-9._:~-]{1,512}. A raw UUID with
 * dashes is fine; we prefix with 'cp' so crosspost-created records are
 * visually distinguishable in the repo.
 */
export function blueskyRkey(postId: string, partIndex = 0): string {
  const safe = postId.replace(/[^A-Za-z0-9_.-]/g, "");
  return partIndex === 0 ? `cp-${safe}` : `cp-${safe}-p${partIndex}`;
}
