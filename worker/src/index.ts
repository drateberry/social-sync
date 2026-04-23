import type { PublishJob } from "@crosspost/shared";
import type { Env } from "./env.js";
import { handleFetch } from "./api.js";
import { runIngestCycle } from "./orchestrator.js";
import { handlePublishBatch } from "./queue/publish.js";

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleFetch(req, env, ctx);
  },

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runIngestCycle(env, ctx));
  },

  async queue(batch: MessageBatch<PublishJob>, env: Env): Promise<void> {
    await handlePublishBatch(batch, env);
  },
} satisfies ExportedHandler<Env, PublishJob>;
