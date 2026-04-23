import type { PublishResult } from "@social-sync/shared";
import { PLATFORM_LIMITS } from "@social-sync/shared";
import type { Env } from "../env.js";
import { splitIntoThread } from "../lib/thread-splitter.js";

interface PublishInput {
  post_id: string;
  text: string;
}

/**
 * Publish to X via /2/tweets.
 *
 * X v2 does not (as of our cutoff) expose an Idempotency-Key header on
 * tweet creation, so we lean on:
 *   - pre-inserted post_mirrors row keyed on idempotency_key → subsequent
 *     attempts with the same key surface as a DB uniqueness conflict, which
 *     the orchestrator treats as "already sent, skip."
 *   - rule 4 (content-hash within 30m) on the inbound poller side as
 *     ultimate backstop.
 * If X adds an idempotency header later, wire it in here.
 */
export async function publishToX(env: Env, input: PublishInput): Promise<PublishResult> {
  if (!env.X_BEARER_TOKEN) throw new Error("X not configured");

  const handle = env.BLUESKY_IDENTIFIER; // placeholder, overridden below
  const parts = splitIntoThread(input.text, { limit: PLATFORM_LIMITS.x.text });

  let inReplyTo: string | null = null;
  let headId = "";
  let authorHandle = handle ?? "";

  for (let i = 0; i < parts.length; i++) {
    const body: Record<string, unknown> = { text: parts[i] };
    if (inReplyTo) body.reply = { in_reply_to_tweet_id: inReplyTo };
    const res = await fetch("https://api.x.com/2/tweets", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.X_BEARER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`x publish failed ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { data: { id: string; text: string } };
    if (i === 0) headId = json.data.id;
    inReplyTo = json.data.id;
  }

  // Best-effort handle for URL — callers supply via env; fetch `/2/users/me`
  // once and cache in settings if this becomes a bottleneck.
  if (!authorHandle) {
    try {
      const me = await fetch("https://api.x.com/2/users/me", {
        headers: { authorization: `Bearer ${env.X_BEARER_TOKEN}` },
      });
      if (me.ok) {
        const j = (await me.json()) as { data: { username: string } };
        authorHandle = j.data.username;
      }
    } catch {
      // fall through
    }
  }

  return {
    platform_post_id: headId,
    platform_url: authorHandle
      ? `https://x.com/${authorHandle}/status/${headId}`
      : `https://x.com/i/web/status/${headId}`,
  };
}
