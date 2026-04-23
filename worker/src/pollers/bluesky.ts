import { AtpAgent } from "@atproto/api";
import type { NormalizedPost } from "@social-sync/shared";
import type { Env } from "../env.js";
import type { Db } from "../lib/db.js";

/**
 * Poll the user's Bluesky repo for new top-level posts.
 *
 * We use `app.bsky.feed.getAuthorFeed` rather than `com.atproto.repo.listRecords`
 * because getAuthorFeed exposes a `reply`/`reason` structure that lets us
 * filter replies and reposts cleanly, and returns an `indexedAt` that we
 * can use for incremental polling via the `cursor`. listRecords would
 * require us to traverse reply refs ourselves to detect replies.
 */
export async function pollBluesky(env: Env, db: Db): Promise<NormalizedPost[]> {
  if (!env.BLUESKY_IDENTIFIER || !env.BLUESKY_APP_PASSWORD) return [];
  const acct = await db.getPlatformAccount("bluesky");
  if (!acct || acct.enabled === 0) return [];

  const agent = new AtpAgent({ service: env.BLUESKY_SERVICE_URL ?? "https://bsky.social" });
  await agent.login({
    identifier: env.BLUESKY_IDENTIFIER,
    password: env.BLUESKY_APP_PASSWORD,
  });

  const res = await agent.getAuthorFeed({
    actor: acct.account_id, // DID
    limit: 30,
    filter: "posts_no_replies",
  });

  const lastSeenMs = acct.last_seen_id ? Number(acct.last_seen_id) : 0;
  const posts: NormalizedPost[] = [];
  let newestIndexedAt = lastSeenMs;

  for (const item of res.data.feed) {
    if (item.reason) continue; // repost
    if (item.reply) continue; // reply
    const indexedAt = new Date(item.post.indexedAt).getTime();
    if (indexedAt <= lastSeenMs) continue;
    newestIndexedAt = Math.max(newestIndexedAt, indexedAt);
    posts.push(normalizeBlueskyPost(item.post as unknown as BskyPostView));
  }

  if (newestIndexedAt > lastSeenMs) {
    await db.updateLastSeen("bluesky", String(newestIndexedAt), Date.now());
  } else {
    await db.updateLastSeen("bluesky", acct.last_seen_id ?? "0", Date.now());
  }

  return posts;
}

interface BskyPostView {
  uri: string;
  cid: string;
  author: { did: string; handle: string };
  record: {
    text: string;
    createdAt: string;
    langs?: string[];
    embed?: unknown;
    facets?: Array<{
      features: Array<{ $type: string; uri?: string }>;
    }>;
  };
  embed?: {
    $type: string;
    images?: Array<{ thumb: string; fullsize: string; alt: string }>;
    external?: { uri: string; title: string; description: string };
  };
  indexedAt: string;
}

export function normalizeBlueskyPost(p: BskyPostView): NormalizedPost {
  const text = p.record.text ?? "";
  const urls = extractUrlsFromFacets(p.record.facets) ?? extractUrlsFromText(text);
  const media =
    p.embed?.$type === "app.bsky.embed.images#view" && p.embed.images
      ? p.embed.images.map((img) => ({
          kind: "image" as const,
          source_url: img.fullsize,
          alt_text: img.alt || null,
          width: null,
          height: null,
        }))
      : [];
  // rkey is the last path segment of the AT-URI
  const rkey = p.uri.split("/").pop() ?? "";
  return {
    platform: "bluesky",
    platform_post_id: p.uri, // use full AT-URI as stable identifier
    url: `https://bsky.app/profile/${p.author.handle}/post/${rkey}`,
    created_at: new Date(p.record.createdAt).getTime(),
    text,
    media,
    urls_in_text: urls,
    is_reply: false,
    is_repost: false,
    is_quote: false,
    raw: p,
  };
}

function extractUrlsFromFacets(
  facets: BskyPostView["record"]["facets"],
): string[] | null {
  if (!facets || facets.length === 0) return null;
  const out: string[] = [];
  for (const f of facets) {
    for (const feat of f.features) {
      if (feat.$type === "app.bsky.richtext.facet#link" && feat.uri) out.push(feat.uri);
    }
  }
  return out.length > 0 ? out : null;
}

function extractUrlsFromText(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>"']+/gi), (m) => m[0]);
}
