import { getCloudflareContext } from "@opennextjs/cloudflare";

type ServiceBinding = { fetch: (req: Request) => Promise<Response> };

/**
 * Call the API worker via the service binding declared in wrangler.toml.
 * The URL host is ignored by the binding — only the path/query/body/headers
 * are forwarded to the target worker.
 */
export async function callApi(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const { env } = getCloudflareContext();
  const api = (env as unknown as { API?: ServiceBinding }).API;
  if (!api) {
    throw new Error(
      "API service binding missing — check [[services]] block in web/wrangler.toml",
    );
  }
  const token = (env as unknown as { ADMIN_TOKEN?: string }).ADMIN_TOKEN;

  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (token) headers.set("x-admin-token", token);

  const req = new Request(`https://api${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });
  return api.fetch(req);
}
