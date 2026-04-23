import type { NormalizedPost, Platform, SkipReason } from "@crosspost/shared";
import {
  BLOG_URL_MATCH_WINDOW_MS,
  CONTENT_HASH_MATCH_WINDOW_MS,
  NOSYNC_TAG,
} from "@crosspost/shared";
import type { Db } from "./db.js";

export type LoopDecision =
  | { action: "skip"; reason: SkipReason; detail?: string }
  | { action: "accept" };

export interface LoopDecisionInput {
  post: NormalizedPost;
  contentHash: string;
  now: number;
  nosyncTag?: string;
}

/**
 * Decide whether a polled post should be accepted as a new origin, or skipped
 * because it is a mirror / duplicate / blog auto-post.
 *
 * Rules are applied in order. The first matching rule wins.
 *
 *   1. mirror: the platform_post_id already lives in post_mirrors → this
 *      post was created by us as a mirror of something from another platform.
 *   2. origin_seen: we already ingested this (platform, post_id) as an
 *      origin on a previous poll.
 *   3. origin_blog: the post references a URL in blog_posts published
 *      within the last 2h → the blog auto-poster made this, not the user.
 *   4. content_hash_recent: a post with the same normalized text + media
 *      byte hash was ingested within the last 30m → almost certainly a
 *      loop that rules 1–3 missed (e.g. crash between publish and DB
 *      write on a platform without idempotency-key support).
 *
 *   Plus: #nosync (case-insensitive whole-tag match) short-circuits to skip.
 *
 * See docs/architecture.md for the rationale behind each rule.
 */
export async function decideSyncAction(
  db: Db,
  input: LoopDecisionInput,
): Promise<LoopDecision> {
  const { post, contentHash, now } = input;
  const nosyncTag = (input.nosyncTag ?? NOSYNC_TAG).toLowerCase();

  if (containsWholeTag(post.text, nosyncTag)) {
    return { action: "skip", reason: "nosync_tag" };
  }

  if (post.is_reply || post.is_repost || post.is_quote) {
    return { action: "skip", reason: "unsupported_kind" };
  }

  // Rule 1 — is this one of our own mirrors coming back around?
  const mirror = await db.findMirrorByPlatformPostId(post.platform, post.platform_post_id);
  if (mirror) {
    return { action: "skip", reason: "mirror", detail: `mirror_id=${mirror.id}` };
  }

  // Rule 2 — have we already ingested this as an origin?
  const existingOrigin = await db.findPostByOrigin(post.platform, post.platform_post_id);
  if (existingOrigin) {
    return { action: "skip", reason: "origin_seen", detail: `post_id=${existingOrigin.id}` };
  }

  // Rule 3 — does this reference a recently-published drateberry.com post?
  const blogMatch = await matchesRecentBlogPost(db, post, now);
  if (blogMatch) {
    return { action: "skip", reason: "origin_blog", detail: `blog_url=${blogMatch}` };
  }

  // Rule 4 — content-hash-within-window safety net.
  const hashMatch = await db.findRecentContentHashMatch(
    contentHash,
    now - CONTENT_HASH_MATCH_WINDOW_MS,
  );
  if (hashMatch) {
    return {
      action: "skip",
      reason: "content_hash_recent",
      detail: `matched_post_id=${hashMatch.id}`,
    };
  }

  return { action: "accept" };
}

function containsWholeTag(text: string, tag: string): boolean {
  const needle = tag.toLowerCase();
  const haystack = text.toLowerCase();
  let i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) {
    const before = i === 0 ? " " : haystack[i - 1]!;
    const after = i + needle.length >= haystack.length ? " " : haystack[i + needle.length]!;
    const isBoundary = (c: string) => !/[\w#]/.test(c);
    if (isBoundary(before) && isBoundary(after)) return true;
    i += needle.length;
  }
  return false;
}

async function matchesRecentBlogPost(
  db: Db,
  post: NormalizedPost,
  now: number,
): Promise<string | null> {
  if (post.urls_in_text.length === 0) return null;
  for (const url of post.urls_in_text) {
    const canonical = canonicalizeUrl(url);
    const blog = await db.findBlogPostByUrl(canonical);
    if (!blog) continue;
    if (Math.abs(post.created_at - blog.published_at) <= BLOG_URL_MATCH_WINDOW_MS) {
      return canonical;
    }
  }
  return null;
}

/** Strip trailing slash, tracking params, and fragment so the URL matches
 * whatever was written into blog_posts. */
export function canonicalizeUrl(input: string): string {
  try {
    const u = new URL(input);
    u.hash = "";
    const drop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "ref_src",
      "ref_url",
      "mc_cid",
      "mc_eid",
      "fbclid",
      "gclid",
    ];
    for (const k of drop) u.searchParams.delete(k);
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return input;
  }
}
