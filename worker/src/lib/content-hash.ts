import type { NormalizedPost } from "@social-sync/shared";

const MENTION_RE = /@[\w.-]+(?:@[\w.-]+)?/g;
const URL_RE = /https?:\/\/\S+/gi;
const WHITESPACE_RE = /\s+/g;

/**
 * Canonicalize post text so that the same logical post hashes identically
 * across platforms. Drops mentions and URLs (they differ by platform:
 * Mastodon expands @user@host, Bluesky uses DIDs, X uses t.co wrappers),
 * and collapses whitespace.
 */
export function normalizeText(text: string): string {
  return text
    .replace(MENTION_RE, "")
    .replace(URL_RE, "")
    .replace(WHITESPACE_RE, " ")
    .trim()
    .toLowerCase();
}

export async function sha256Hex(input: string | ArrayBuffer | Uint8Array): Promise<string> {
  const buf =
    typeof input === "string"
      ? new TextEncoder().encode(input)
      : input instanceof Uint8Array
        ? input
        : new Uint8Array(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Compute a content hash for a normalized post. The hash must be stable
 * across platforms, so media is keyed by its bytes (caller supplies the
 * sorted list of sha256 hex digests of the image/video bytes).
 */
export async function computeContentHash(
  post: NormalizedPost,
  mediaByteHashes: string[],
): Promise<string> {
  const sortedMedia = [...mediaByteHashes].sort();
  const payload = JSON.stringify({
    t: normalizeText(post.text),
    m: sortedMedia,
  });
  return sha256Hex(payload);
}
