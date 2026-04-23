import type { Env } from "../env.js";
import type { Db } from "../lib/db.js";
import { canonicalizeUrl } from "../lib/loop-prevention.js";

/**
 * Poll the configured blog's RSS/Atom feed and upsert entries into blog_posts.
 * Used by loop-prevention rule 3 to suppress re-syncing the blog's
 * auto-posted announcements across all 3 networks.
 *
 * Supports RSS 2.0 (<item>) and Atom (<entry>). Deliberately a small,
 * permissive parser — we only need url + title + published date.
 */
export async function pollBlogFeed(env: Env, db: Db): Promise<number> {
  const url = env.BLOG_FEED_URL;
  if (!url) return 0;

  const res = await fetch(url, {
    headers: { "user-agent": "social-sync/0.1 blog-feed poller" },
  });
  if (!res.ok) {
    await db.logEvent("warn", `blog feed fetch failed ${res.status}`, { data: { url } });
    return 0;
  }
  const xml = await res.text();
  const entries = parseFeed(xml);
  const now = Date.now();
  let count = 0;
  for (const e of entries) {
    const canon = canonicalizeUrl(e.url);
    await db.upsertBlogPost({
      url: canon,
      title: e.title,
      published_at: e.published_at,
      discovered_at: now,
    });
    count++;
  }
  return count;
}

interface FeedEntry {
  url: string;
  title: string;
  published_at: number;
}

export function parseFeed(xml: string): FeedEntry[] {
  // Detect feed type by root element.
  if (/<rss\b/.test(xml) || /<channel\b/.test(xml)) return parseRss(xml);
  if (/<feed\b/.test(xml)) return parseAtom(xml);
  return [];
}

function parseRss(xml: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  for (const m of xml.matchAll(itemRe)) {
    const body = m[1]!;
    const link = extractTag(body, "link");
    const guid = extractTag(body, "guid");
    const url = (link || guid || "").trim();
    if (!url) continue;
    const title = (extractTag(body, "title") || "").trim();
    const pubDate = (extractTag(body, "pubDate") || extractTag(body, "dc:date") || "").trim();
    const ts = pubDate ? Date.parse(pubDate) : NaN;
    out.push({ url, title, published_at: Number.isFinite(ts) ? ts : Date.now() });
  }
  return out;
}

function parseAtom(xml: string): FeedEntry[] {
  const out: FeedEntry[] = [];
  const entryRe = /<entry\b[^>]*>([\s\S]*?)<\/entry>/gi;
  for (const m of xml.matchAll(entryRe)) {
    const body = m[1]!;
    // Prefer rel="alternate"; fall back to first <link>.
    const altMatch =
      body.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i) ||
      body.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    const url = altMatch?.[1]?.trim() ?? "";
    if (!url) continue;
    const title = (extractTag(body, "title") || "").trim();
    const published = (extractTag(body, "published") || extractTag(body, "updated") || "").trim();
    const ts = published ? Date.parse(published) : NaN;
    out.push({ url, title, published_at: Number.isFinite(ts) ? ts : Date.now() });
  }
  return out;
}

function extractTag(body: string, tag: string): string | null {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = body.match(re);
  if (!m?.[1]) return null;
  return stripCdata(m[1]!)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripCdata(s: string): string {
  const m = s.match(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/);
  return m ? m[1]! : s;
}
