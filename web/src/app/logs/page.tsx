import { Card, CardTitle } from "@/components/card";
import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

const LEVEL_STYLES: Record<string, string> = {
  info: "text-[var(--muted)]",
  warn: "text-amber-600 dark:text-amber-400",
  error: "text-red-600 dark:text-red-400",
};

export default async function LogsPage() {
  let events;
  try {
    events = await api.logs();
  } catch (e) {
    return (
      <Card>
        <CardTitle>Logs</CardTitle>
        <p className="text-sm text-[var(--muted)]">Could not load logs.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
      <Card className="p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-[var(--border)] text-left text-xs uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-6 py-3">When</th>
              <th className="px-6 py-3">Level</th>
              <th className="px-6 py-3">Platform</th>
              <th className="px-6 py-3">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)] font-mono text-xs">
            {events.map((e) => (
              <tr key={e.id}>
                <td className="whitespace-nowrap px-6 py-2 text-[var(--muted)]">
                  {new Date(e.occurred_at).toLocaleString()}
                </td>
                <td className={`px-6 py-2 ${LEVEL_STYLES[e.level] ?? ""}`}>{e.level}</td>
                <td className="px-6 py-2 text-[var(--muted)]">{e.platform ?? "—"}</td>
                <td className="px-6 py-2">{e.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
