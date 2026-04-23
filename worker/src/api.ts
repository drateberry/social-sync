import type { Env } from "./env.js";
import { Db } from "./lib/db.js";
import { runIngestCycle } from "./orchestrator.js";
import { pollBlogFeed } from "./pollers/blog.js";

/**
 * Minimal JSON admin API consumed by the Next.js dashboard.
 * All endpoints require either Cloudflare Access (recommended — see README)
 * OR a valid `x-admin-token` header matching the ADMIN_PASSWORD_HASH secret.
 * Cloudflare Access is enforced at the edge, so if the request reaches us
 * it's already authenticated there.
 */
export async function handleFetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(req.url);
  const db = new Db(env.DB);

  if (url.pathname === "/api/health") {
    return json({ ok: true, ts: Date.now() });
  }

  if (!(await authorize(req, env))) {
    return new Response("unauthorized", { status: 401 });
  }

  try {
    if (url.pathname === "/api/summary" && req.method === "GET") {
      return json(await summary(db));
    }
    if (url.pathname === "/api/posts" && req.method === "GET") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
      const posts = await db.listRecentPosts(limit);
      const mirrors = await db.listMirrorsForPosts(posts.map((p) => p.id));
      const byPost = new Map<string, typeof mirrors>();
      for (const m of mirrors) {
        const arr = byPost.get(m.post_id) ?? [];
        arr.push(m);
        byPost.set(m.post_id, arr);
      }
      return json(
        posts.map((p) => ({ ...p, mirrors: byPost.get(p.id) ?? [] })),
      );
    }
    if (url.pathname === "/api/settings" && req.method === "GET") {
      return json(await db.getAllSettings());
    }
    if (url.pathname === "/api/settings" && req.method === "POST") {
      const body = (await req.json()) as Record<string, string>;
      for (const [k, v] of Object.entries(body)) await db.setSetting(k, String(v));
      return json({ ok: true });
    }
    if (url.pathname === "/api/logs" && req.method === "GET") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), 2000);
      return json(await db.recentEvents(limit));
    }
    if (url.pathname === "/api/run-cycle" && req.method === "POST") {
      ctx.waitUntil(runIngestCycle(env, ctx));
      return json({ ok: true });
    }
    if (url.pathname === "/api/blog/refresh" && req.method === "POST") {
      const count = await pollBlogFeed(env, db);
      return json({ ok: true, count });
    }
    return new Response("not found", { status: 404 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: msg }, 500);
  }
}

async function summary(db: Db): Promise<unknown> {
  const settings = await db.getAllSettings();
  const map = new Map(settings.map((s) => [s.key, s.value]));
  const month = new Date().toISOString().slice(0, 7);
  const spend = {
    x: await db.getMonthlySpend("x", month),
    mastodon: await db.getMonthlySpend("mastodon", month),
    bluesky: await db.getMonthlySpend("bluesky", month),
  };
  const ceiling = Number(map.get("x_monthly_ceiling_usd") ?? 5);
  const accounts = {
    x: await db.getPlatformAccount("x"),
    mastodon: await db.getPlatformAccount("mastodon"),
    bluesky: await db.getPlatformAccount("bluesky"),
  };
  return { month, spend, ceiling, accounts, settings: Object.fromEntries(map) };
}

async function authorize(req: Request, env: Env): Promise<boolean> {
  // Cloudflare Access injects the CF-Access-Authenticated-User-Email
  // header when the request has passed Access. Trust it if present.
  if (req.headers.get("cf-access-authenticated-user-email")) return true;

  // Fallback: bearer token compared against ADMIN_PASSWORD_HASH (sha256).
  if (!env.ADMIN_PASSWORD_HASH) return false;
  const auth = req.headers.get("x-admin-token");
  if (!auth) return false;
  const digest = await sha256Hex(auth);
  return constantTimeEq(digest, env.ADMIN_PASSWORD_HASH);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "content-type, x-admin-token",
    },
  });
}
