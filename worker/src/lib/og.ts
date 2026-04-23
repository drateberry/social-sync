import { OG_CACHE_TTL_MS } from "@crosspost/shared";
import type { Db } from "./db.js";

export interface OgCard {
  url: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
}

/**
 * Fetch OpenGraph metadata for a URL, caching in D1 for 7 days.
 * Falls back to returning nulls if the fetch fails — callers should
 * publish the post without a card rather than blocking the sync.
 */
export async function getOgCard(db: Db, url: string): Promise<OgCard> {
  const cached = await db.getOgCache(url);
  if (cached && Date.now() - cached.fetched_at < OG_CACHE_TTL_MS) {
    return {
      url,
      title: cached.title,
      description: cached.description,
      image_url: cached.image_url,
    };
  }

  const card = await fetchOgCard(url);
  await db.upsertOgCache({
    url,
    title: card.title,
    description: card.description,
    image_url: card.image_url,
    fetched_at: Date.now(),
  });
  return card;
}

export async function fetchOgCard(url: string): Promise<OgCard> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "crosspost-sync/0.1 OG fetcher" },
      redirect: "follow",
    });
    if (!res.ok) return { url, title: null, description: null, image_url: null };
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html")) return { url, title: null, description: null, image_url: null };
    const html = await res.text();
    return parseOg(url, html);
  } catch {
    return { url, title: null, description: null, image_url: null };
  }
}

export function parseOg(url: string, html: string): OgCard {
  const head = html.slice(0, 64 * 1024); // cap parse surface
  const get = (prop: string) =>
    matchMeta(head, ["property", prop]) ?? matchMeta(head, ["name", prop]);

  const title =
    get("og:title") ??
    get("twitter:title") ??
    extractTitle(head) ??
    null;
  const description =
    get("og:description") ??
    get("twitter:description") ??
    get("description") ??
    null;
  let image = get("og:image") ?? get("og:image:url") ?? get("twitter:image") ?? null;
  if (image) image = absoluteUrl(image, url);

  return { url, title, description, image_url: image };
}

function matchMeta(head: string, attr: [string, string]): string | null {
  const [k, v] = attr;
  const pattern = new RegExp(
    `<meta[^>]+${k}=["']${escapeRegex(v)}["'][^>]*content=["']([^"']*)["'][^>]*>`,
    "i",
  );
  const pattern2 = new RegExp(
    `<meta[^>]+content=["']([^"']*)["'][^>]*${k}=["']${escapeRegex(v)}["'][^>]*>`,
    "i",
  );
  return head.match(pattern)?.[1] ?? head.match(pattern2)?.[1] ?? null;
}

function extractTitle(head: string): string | null {
  return head.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function absoluteUrl(maybeRelative: string, base: string): string {
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return maybeRelative;
  }
}
