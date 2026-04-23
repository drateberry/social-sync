import { AtpAgent, RichText } from "@atproto/api";
import type { PublishResult } from "@crosspost/shared";
import type { Env } from "../env.js";
import { blueskyRkey } from "../lib/idempotency.js";
import { splitIntoThread } from "../lib/thread-splitter.js";
import { PLATFORM_LIMITS } from "@crosspost/shared";

interface PublishInput {
  post_id: string;
  text: string;
}

export async function publishToBluesky(
  env: Env,
  input: PublishInput,
): Promise<PublishResult> {
  if (!env.BLUESKY_IDENTIFIER || !env.BLUESKY_APP_PASSWORD) {
    throw new Error("Bluesky not configured");
  }
  const agent = new AtpAgent({ service: env.BLUESKY_SERVICE_URL ?? "https://bsky.social" });
  await agent.login({
    identifier: env.BLUESKY_IDENTIFIER,
    password: env.BLUESKY_APP_PASSWORD,
  });
  const did = agent.session?.did;
  const handle = agent.session?.handle;
  if (!did || !handle) throw new Error("Bluesky login did not return session");

  const parts = splitIntoThread(input.text, { limit: PLATFORM_LIMITS.bluesky.text });

  let rootRef: { uri: string; cid: string } | null = null;
  let parentRef: { uri: string; cid: string } | null = null;
  let headUri = "";

  for (let i = 0; i < parts.length; i++) {
    const rkey = blueskyRkey(input.post_id, i);
    const rt = new RichText({ text: parts[i]! });
    await rt.detectFacets(agent);
    const record: Record<string, unknown> = {
      $type: "app.bsky.feed.post",
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
    };
    if (parentRef && rootRef) {
      record.reply = { root: rootRef, parent: parentRef };
    }
    const res = await agent.com.atproto.repo.putRecord({
      repo: did,
      collection: "app.bsky.feed.post",
      rkey,
      record,
    });
    const ref = { uri: res.data.uri, cid: res.data.cid };
    if (i === 0) {
      rootRef = ref;
      headUri = ref.uri;
    }
    parentRef = ref;
  }

  const headRkey = headUri.split("/").pop() ?? "";
  return {
    platform_post_id: headUri,
    platform_url: `https://bsky.app/profile/${handle}/post/${headRkey}`,
  };
}
