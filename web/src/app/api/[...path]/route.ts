import type { NextRequest } from "next/server";
import { callApi } from "@/lib/worker-api";

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  const targetPath = `/api/${path.join("/")}${req.nextUrl.search}`;

  const init: RequestInit = {
    method: req.method,
    headers: { "content-type": req.headers.get("content-type") ?? "application/json" },
  };
  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = await req.text();
  }

  const res = await callApi(targetPath, init);
  return new Response(await res.text(), {
    status: res.status,
    headers: {
      "content-type": res.headers.get("content-type") ?? "application/json",
    },
  });
}

export { proxy as GET, proxy as POST, proxy as PUT, proxy as DELETE, proxy as PATCH };
