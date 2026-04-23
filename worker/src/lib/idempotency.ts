import type { Platform } from "@social-sync/shared";

/**
 * Deterministic idempotency key derived from our internal post_id and
 * target platform. Used:
 *   - Mastodon: as Idempotency-Key header (native dedup on the server side)
 *   - Bluesky: seed for blueskyRkey, which derives a TID (see below)
 *   - X: sent with the publish request when/if X adds support; otherwise
 *     we rely on the pending-mirror row keyed on this value to catch
 *     same-input retries at our side.
 */
export function idempotencyKey(postId: string, target: Platform): string {
  return `${postId}:${target}`;
}

// TID spec: 13 chars from base32-sortable. First char is restricted because
// the top bit of the underlying u64 must be 0.
// See https://atproto.com/specs/tid
const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
const TID_FIRST_CHAR_ALPHABET = "234567abcdefghij";

/**
 * app.bsky.feed.post records require rkeys to be valid TIDs (13-char
 * base32-sortable). We derive one deterministically from postId+partIndex
 * via SHA-256 so retries of the same publish land on the same record key
 * (putRecord is idempotent on collision).
 */
export async function blueskyRkey(postId: string, partIndex = 0): Promise<string> {
  const seed = `${postId}:${partIndex}`;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(seed),
  );
  const bytes = new Uint8Array(digest);
  const chars: string[] = [TID_FIRST_CHAR_ALPHABET[bytes[0]! % 16]!];
  for (let i = 1; i < 13; i++) {
    chars.push(TID_ALPHABET[bytes[i]! % 32]!);
  }
  return chars.join("");
}
