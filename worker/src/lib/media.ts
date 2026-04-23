import { sha256Hex } from "./content-hash.js";

/**
 * Fetch media from a source URL and cache it in R2 under the post_id. The
 * stored bytes are the canonical copy re-uploaded to each target platform.
 * The sha256 of the bytes is returned so content-hash can incorporate it.
 */
export async function cacheMedia(
  r2: R2Bucket,
  postId: string,
  index: number,
  sourceUrl: string,
): Promise<{ key: string; sha256: string; contentType: string; bytes: ArrayBuffer }> {
  const res = await fetch(sourceUrl);
  if (!res.ok) {
    throw new Error(`media fetch failed ${res.status}: ${sourceUrl}`);
  }
  const contentType = res.headers.get("content-type") ?? "application/octet-stream";
  const bytes = await res.arrayBuffer();
  const hash = await sha256Hex(bytes);
  const ext = extensionFor(contentType, sourceUrl);
  const key = `media/${postId}/${index}.${ext}`;
  await r2.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: { sha256: hash, source_url: sourceUrl },
  });
  return { key, sha256: hash, contentType, bytes };
}

export async function readMedia(
  r2: R2Bucket,
  key: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const obj = await r2.get(key);
  if (!obj) return null;
  return {
    bytes: await obj.arrayBuffer(),
    contentType: obj.httpMetadata?.contentType ?? "application/octet-stream",
  };
}

function extensionFor(contentType: string, url: string): string {
  const ct = contentType.toLowerCase();
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpg";
  if (ct.includes("png")) return "png";
  if (ct.includes("gif")) return "gif";
  if (ct.includes("webp")) return "webp";
  if (ct.includes("mp4")) return "mp4";
  const m = url.match(/\.([a-z0-9]{2,5})(?:\?|#|$)/i);
  return m?.[1]?.toLowerCase() ?? "bin";
}
