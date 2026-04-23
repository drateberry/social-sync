import { Card, CardTitle, Stat } from "@/components/card";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let summary = null;
  let error: string | null = null;
  try {
    summary = await api.summary();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  if (error || !summary) {
    return (
      <Card>
        <CardTitle>Connection error</CardTitle>
        <p className="text-sm text-[var(--muted)]">
          Could not reach the worker at <code className="font-mono">{process.env.NEXT_PUBLIC_WORKER_URL}</code>.
        </p>
        {error && <pre className="mt-3 font-mono text-xs text-[var(--muted)]">{error}</pre>}
      </Card>
    );
  }

  const spend = summary.spend.x;
  const pct = summary.ceiling > 0 ? Math.min(100, (spend / summary.ceiling) * 100) : 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">{summary.month}</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {(["mastodon", "bluesky", "x"] as const).map((p) => {
          const a = summary!.accounts[p];
          return (
            <Card key={p}>
              <CardTitle>{p}</CardTitle>
              <Stat
                label="handle"
                value={a?.handle ?? "not connected"}
                sublabel={
                  a?.last_polled_at
                    ? `last polled ${new Date(a.last_polled_at).toLocaleString()}`
                    : undefined
                }
              />
            </Card>
          );
        })}
      </div>

      <Card>
        <CardTitle>X API spend this month</CardTitle>
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-3xl tabular-nums">${spend.toFixed(3)}</span>
          <span className="text-sm text-[var(--muted)]">of ${summary.ceiling.toFixed(2)}</span>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded bg-[var(--border)]">
          <div
            className="h-full bg-[var(--accent)]"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">
          See <a className="underline" href="/settings">Settings</a> to adjust the ceiling.
          Reads pause automatically when the month&apos;s spend reaches the ceiling.
        </p>
      </Card>
    </div>
  );
}
