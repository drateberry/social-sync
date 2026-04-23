import type { NormalizedMedia, NormalizedPost } from "@social-sync/shared";
import type { Env } from "../env.js";
import type { Db } from "../lib/db.js";
import { normalizeBaseUrl } from "../lib/url.js";

interface MastodonStatus {
  id: string;
  uri: string;
  url: string;
  content: string; // HTML
  created_at: string;
  in_reply_to_id: string | null;
  reblog: unknown | null;
  visibility: string;
  media_attachments: Array<{
    id: string;
    type: "image" | "video" | "gifv" | "audio" | "unknown";
    url: string;
    description: string | null;
    meta?: { original?: { width?: number; height?: number } };
  }>;
  application?: { name: string; website: string | null } | null;
}

interface MastodonInstanceV2 {
  configuration?: {
    statuses?: { max_characters?: number };
  };
  // v1 fallback
  max_toot_chars?: number;
}

export async function fetchInstanceMaxChars(instanceUrl: string): Promise<number | null> {
  try {
    const r = await fetch(`${instanceUrl.replace(/\/$/, "")}/api/v2/instance`);
    if (r.ok) {
      const json = (await r.json()) as MastodonInstanceV2;
      const v2 = json.configuration?.statuses?.max_characters;
      if (typeof v2 === "number") return v2;
      if (typeof json.max_toot_chars === "number") return json.max_toot_chars;
    }
    // Fallback to v1
    const r1 = await fetch(`${instanceUrl.replace(/\/$/, "")}/api/v1/instance`);
    if (r1.ok) {
      const json = (await r1.json()) as MastodonInstanceV2;
      return json.configuration?.statuses?.max_characters ?? json.max_toot_chars ?? null;
    }
  } catch {
    return null;
  }
  return null;
}

export async function pollMastodon(env: Env, db: Db): Promise<NormalizedPost[]> {
  if (!env.MASTODON_INSTANCE_URL || !env.MASTODON_ACCESS_TOKEN) {
    return [];
  }
  const acct = await db.getPlatformAccount("mastodon");
  if (!acct || acct.enabled === 0) return [];

  const base = normalizeBaseUrl(env.MASTODON_INSTANCE_URL);
  const params = new URLSearchParams({
    limit: "40",
    exclude_replies: "true",
    exclude_reblogs: "true",
  });
  if (acct.last_seen_id) params.set("since_id", acct.last_seen_id);

  const res = await fetch(`${base}/api/v1/accounts/${acct.account_id}/statuses?${params}`, {
    headers: { authorization: `Bearer ${env.MASTODON_ACCESS_TOKEN}` },
  });
  if (!res.ok) {
    throw new Error(`mastodon poll failed ${res.status}: ${await res.text()}`);
  }
  const statuses = (await res.json()) as MastodonStatus[];
  statuses.sort((a, b) => a.id.localeCompare(b.id)); // oldest first

  const posts = statuses.map(normalizeMastodonStatus);
  if (statuses.length > 0) {
    const newest = statuses[statuses.length - 1]!;
    await db.updateLastSeen("mastodon", newest.id, Date.now());
  } else {
    await db.updateLastSeen("mastodon", acct.last_seen_id ?? "0", Date.now());
  }
  return posts;
}

export function normalizeMastodonStatus(s: MastodonStatus): NormalizedPost {
  const text = htmlToText(s.content);
  const urls = extractUrls(text);
  const media: NormalizedMedia[] = s.media_attachments
    .filter((m) => m.type === "image" || m.type === "video" || m.type === "gifv")
    .map((m) => ({
      kind: m.type === "gifv" ? "gif" : (m.type as "image" | "video"),
      source_url: m.url,
      alt_text: m.description ?? null,
      width: m.meta?.original?.width ?? null,
      height: m.meta?.original?.height ?? null,
    }));
  return {
    platform: "mastodon",
    platform_post_id: s.id,
    url: s.url,
    created_at: new Date(s.created_at).getTime(),
    text,
    media,
    urls_in_text: urls,
    is_reply: !!s.in_reply_to_id,
    is_repost: !!s.reblog,
    is_quote: false,
    raw: s,
  };
}

/** Minimal HTML → text: strip tags, decode the most common entities,
 * preserve paragraph/line breaks. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*<p>/gi, "\n\n")
    .replace(/<\/?p[^>]*>/gi, "")
    .replace(/<a[^>]*href="([^"]+)"[^>]*>[^<]*<\/a>/gi, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s<>"']+/gi;
  return Array.from(text.matchAll(re), (m) => m[0]);
}
