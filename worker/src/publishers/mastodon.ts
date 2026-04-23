import type { PublishResult } from "@social-sync/shared";
import type { Env } from "../env.js";
import { idempotencyKey } from "../lib/idempotency.js";
import { splitIntoThread } from "../lib/thread-splitter.js";
import { normalizeBaseUrl } from "../lib/url.js";
import { PLATFORM_LIMITS } from "@social-sync/shared";

interface PublishInput {
  post_id: string;
  text: string;
  max_chars?: number | null;
}

interface MastodonStatusResponse {
  id: string;
  url: string;
}

export async function publishToMastodon(
  env: Env,
  input: PublishInput,
): Promise<PublishResult> {
  if (!env.MASTODON_INSTANCE_URL || !env.MASTODON_ACCESS_TOKEN) {
    throw new Error("Mastodon not configured");
  }
  const base = normalizeBaseUrl(env.MASTODON_INSTANCE_URL);
  const limit = input.max_chars ?? PLATFORM_LIMITS.mastodon.text;
  const parts = splitIntoThread(input.text, { limit });

  let inReplyTo: string | null = null;
  let head: MastodonStatusResponse | null = null;

  for (let i = 0; i < parts.length; i++) {
    const body = new URLSearchParams({ status: parts[i]! });
    if (inReplyTo) body.set("in_reply_to_id", inReplyTo);

    const idemKey = parts.length === 1
      ? idempotencyKey(input.post_id, "mastodon")
      : `${idempotencyKey(input.post_id, "mastodon")}:p${i}`;

    const res = await fetch(`${base}/api/v1/statuses`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.MASTODON_ACCESS_TOKEN}`,
        "content-type": "application/x-www-form-urlencoded",
        "idempotency-key": idemKey,
      },
      body,
    });
    if (!res.ok) {
      throw new Error(`mastodon publish failed ${res.status}: ${await res.text()}`);
    }
    const status = (await res.json()) as MastodonStatusResponse;
    if (i === 0) head = status;
    inReplyTo = status.id;
  }

  if (!head) throw new Error("mastodon publish returned no head status");
  return { platform_post_id: head.id, platform_url: head.url };
}
