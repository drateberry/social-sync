import { Card, CardTitle } from "@/components/card";
import { api } from "@/lib/api";
import type { Platform, PostStatus } from "@crosspost/shared";

export const dynamic = "force-dynamic";

const PLATFORMS: Platform[] = ["x", "mastodon", "bluesky"];

const STATUS_STYLES: Record<PostStatus, string> = {
  published: "text-emerald-600 dark:text-emerald-400",
  pending: "text-amber-600 dark:text-amber-400",
  failed: "text-red-600 dark:text-red-400",
  skipped: "text-[var(--muted)]",
};

export default async function PostsPage() {
  let posts: Awaited<ReturnType<typeof api.posts>> | null = null;
  try {
    posts = await api.posts();
  } catch {
    return (
      <Card>
        <CardTitle>Posts</CardTitle>
        <p className="text-sm text-[var(--muted)]">Could not load posts from the worker.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Posts</h1>
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-6 py-3">When</th>
              <th className="px-6 py-3">Origin</th>
              <th className="px-6 py-3">Text</th>
              {PLATFORMS.map((p) => (
                <th key={p} className="px-6 py-3">{p}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {posts.length === 0 && (
              <tr>
                <td colSpan={3 + PLATFORMS.length} className="px-6 py-8 text-center text-[var(--muted)]">
                  No posts yet.
                </td>
              </tr>
            )}
            {posts.map((p) => {
              const byPlatform = new Map(p.mirrors.map((m) => [m.platform, m]));
              return (
                <tr key={p.id} className="align-top">
                  <td className="whitespace-nowrap px-6 py-3 font-mono text-xs text-[var(--muted)]">
                    {new Date(p.created_at).toLocaleString()}
                  </td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <a href={p.origin_url} target="_blank" rel="noreferrer" className="underline">
                      {p.origin_platform}
                    </a>
                  </td>
                  <td className="max-w-md px-6 py-3 text-[var(--fg)]">
                    <div className="line-clamp-2">{p.normalized_text}</div>
                  </td>
                  {PLATFORMS.map((pf) => {
                    if (pf === p.origin_platform) {
                      return (
                        <td key={pf} className="px-6 py-3 text-xs text-[var(--muted)]">
                          origin
                        </td>
                      );
                    }
                    const m = byPlatform.get(pf);
                    if (!m)
                      return (
                        <td key={pf} className="px-6 py-3 text-xs text-[var(--muted)]">
                          —
                        </td>
                      );
                    return (
                      <td key={pf} className={`px-6 py-3 text-xs ${STATUS_STYLES[m.status]}`}>
                        {m.platform_url ? (
                          <a href={m.platform_url} target="_blank" rel="noreferrer" className="underline">
                            {m.status}
                          </a>
                        ) : (
                          m.skip_reason ?? m.status
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
