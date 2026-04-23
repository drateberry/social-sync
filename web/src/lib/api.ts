import type {
  PlatformAccountRow,
  PostRow,
  PostMirrorRow,
  SyncEventRow,
  SettingsRow,
} from "@social-sync/shared";

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL ?? "";

export interface Summary {
  month: string;
  spend: { x: number; mastodon: number; bluesky: number };
  ceiling: number;
  accounts: {
    x: PlatformAccountRow | null;
    mastodon: PlatformAccountRow | null;
    bluesky: PlatformAccountRow | null;
  };
  settings: Record<string, string>;
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${WORKER_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

export const api = {
  summary: () => fetchApi<Summary>("/api/summary"),
  posts: () =>
    fetchApi<(PostRow & { mirrors: PostMirrorRow[] })[]>("/api/posts"),
  settings: () => fetchApi<SettingsRow[]>("/api/settings"),
  logs: (limit = 500) => fetchApi<SyncEventRow[]>(`/api/logs?limit=${limit}`),
  saveSettings: (patch: Record<string, string>) =>
    fetchApi<{ ok: boolean }>("/api/settings", {
      method: "POST",
      body: JSON.stringify(patch),
    }),
  runCycle: () =>
    fetchApi<{ ok: boolean }>("/api/run-cycle", { method: "POST" }),
};
