import type { NormalizedMedia, NormalizedPost } from "@crosspost/shared";
import { X_OWNED_READ_PRICE_USD } from "@crosspost/shared";
import type { Env } from "../env.js";
import type { Db } from "../lib/db.js";

interface XTweet {
  id: string;
  text: string;
  created_at: string;
  author_id?: string;
  in_reply_to_user_id?: string;
  referenced_tweets?: Array<{ type: "replied_to" | "retweeted" | "quoted"; id: string }>;
  entities?: { urls?: Array<{ url: string; expanded_url: string }> };
  attachments?: { media_keys?: string[] };
}

interface XMedia {
  media_key: string;
  type: "photo" | "video" | "animated_gif";
  url?: string;
  preview_image_url?: string;
  alt_text?: string;
  width?: number;
  height?: number;
}

interface XUsersTweetsResponse {
  data?: XTweet[];
  includes?: { media?: XMedia[] };
  meta?: { newest_id?: string; oldest_id?: string; result_count?: number };
}

/**
 * Poll X for the authed user's own recent tweets.
 *
 * Every `data` element returned is one "Owned Read" billed at
 * X_OWNED_READ_PRICE_USD (deduped per-tweet-id within 24h UTC). We record
 * the estimated cost before returning so the dashboard can show it.
 *
 * Reads are skipped entirely if the monthly ceiling has been hit — see
 * isXReadingPaused().
 */
export async function pollX(env: Env, db: Db): Promise<NormalizedPost[]> {
  if (env.ENABLE_X_SYNC !== "true") return [];
  if (!env.X_BEARER_TOKEN) return [];
  const acct = await db.getPlatformAccount("x");
  if (!acct || acct.enabled === 0) return [];

  if (await isXReadingPaused(db)) {
    await db.logEvent("warn", "X reads paused; monthly ceiling hit", { platform: "x" });
    return [];
  }

  const params = new URLSearchParams({
    max_results: "50",
    "tweet.fields": "created_at,entities,referenced_tweets,attachments,in_reply_to_user_id",
    "media.fields": "url,preview_image_url,alt_text,width,height",
    expansions: "attachments.media_keys",
  });
  if (acct.last_seen_id) params.set("since_id", acct.last_seen_id);

  const res = await fetch(
    `https://api.x.com/2/users/${acct.account_id}/tweets?${params}`,
    { headers: { authorization: `Bearer ${env.X_BEARER_TOKEN}` } },
  );
  if (!res.ok) {
    throw new Error(`x poll failed ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as XUsersTweetsResponse;
  const tweets = json.data ?? [];
  const mediaById = new Map((json.includes?.media ?? []).map((m) => [m.media_key, m]));

  if (tweets.length > 0) {
    const cost = tweets.length * X_OWNED_READ_PRICE_USD;
    await db.recordApiUsage("x", "GET /2/users/:id/tweets", tweets.length, cost, Date.now());
  }

  tweets.sort((a, b) => a.id.localeCompare(b.id));
  if (json.meta?.newest_id) {
    await db.updateLastSeen("x", json.meta.newest_id, Date.now());
  } else {
    await db.updateLastSeen("x", acct.last_seen_id ?? "0", Date.now());
  }

  return tweets.map((t) => normalizeXTweet(t, mediaById, acct.handle));
}

export function normalizeXTweet(
  t: XTweet,
  mediaById: Map<string, XMedia>,
  handle: string,
): NormalizedPost {
  const refs = t.referenced_tweets ?? [];
  const is_reply = refs.some((r) => r.type === "replied_to");
  const is_repost = refs.some((r) => r.type === "retweeted");
  const is_quote = refs.some((r) => r.type === "quoted");

  // Expand t.co → original URLs in text.
  let text = t.text;
  for (const u of t.entities?.urls ?? []) {
    if (u.url && u.expanded_url) {
      text = text.split(u.url).join(u.expanded_url);
    }
  }

  const urls = (t.entities?.urls ?? []).map((u) => u.expanded_url).filter(Boolean);

  const media: NormalizedMedia[] = (t.attachments?.media_keys ?? [])
    .map((k) => mediaById.get(k))
    .filter((m): m is XMedia => !!m)
    .map((m): NormalizedMedia => ({
      kind: m.type === "photo" ? "image" : m.type === "animated_gif" ? "gif" : "video",
      source_url: m.url ?? m.preview_image_url ?? "",
      alt_text: m.alt_text ?? null,
      width: m.width ?? null,
      height: m.height ?? null,
    }))
    .filter((m) => m.source_url);

  return {
    platform: "x",
    platform_post_id: t.id,
    url: `https://x.com/${handle}/status/${t.id}`,
    created_at: new Date(t.created_at).getTime(),
    text,
    media,
    urls_in_text: urls,
    is_reply,
    is_repost,
    is_quote,
    raw: t,
  };
}

export async function isXReadingPaused(db: Db): Promise<boolean> {
  const paused = await db.getSetting("x_reads_paused");
  if (paused === "true") return true;
  const ceilingRaw = await db.getSetting("x_monthly_ceiling_usd");
  const ceiling = ceilingRaw ? Number(ceilingRaw) : 5;
  const month = new Date().toISOString().slice(0, 7);
  const spent = await db.getMonthlySpend("x", month);
  return spent >= ceiling;
}
