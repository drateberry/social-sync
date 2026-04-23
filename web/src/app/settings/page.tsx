"use client";

import { useEffect, useState } from "react";
import { Card, CardTitle } from "@/components/card";
import { api } from "@/lib/api";

type SettingRow = { key: string; value: string; updated_at: number };

const TOGGLE_KEYS = [
  "sync_mastodon_to_bluesky",
  "sync_bluesky_to_mastodon",
  "sync_x_to_mastodon",
  "sync_x_to_bluesky",
  "sync_mastodon_to_x",
  "sync_bluesky_to_x",
];

export default function SettingsPage() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [pending, setPending] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function load() {
    try {
      const r = await api.settings();
      setRows(r);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const get = (key: string) => pending[key] ?? rows.find((r) => r.key === key)?.value ?? "";

  const set = (key: string, value: string) => {
    setPending((p) => ({ ...p, [key]: value }));
    setSaved(false);
  };

  async function save() {
    try {
      await api.saveSettings(pending);
      setPending({});
      setSaved(true);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <p className="text-sm text-[var(--muted)]">Loading…</p>;
  if (err)
    return (
      <Card>
        <CardTitle>Settings</CardTitle>
        <pre className="font-mono text-xs text-[var(--muted)]">{err}</pre>
      </Card>
    );

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card>
        <CardTitle>Sync pairs</CardTitle>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {TOGGLE_KEYS.map((k) => (
            <label key={k} className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={get(k) === "true"}
                onChange={(e) => set(k, e.target.checked ? "true" : "false")}
              />
              <span className="font-mono">{k.replace("sync_", "").replace("_to_", " → ")}</span>
            </label>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>X API</CardTitle>
        <label className="block text-sm">
          Monthly ceiling (USD)
          <input
            type="number"
            step="0.01"
            className="mt-1 block w-48 rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-sm"
            value={get("x_monthly_ceiling_usd")}
            onChange={(e) => set("x_monthly_ceiling_usd", e.target.value)}
          />
        </label>
        <label className="mt-4 flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={get("x_reads_paused") === "true"}
            onChange={(e) => set("x_reads_paused", e.target.checked ? "true" : "false")}
          />
          Manually pause X reads
        </label>
      </Card>

      <Card>
        <CardTitle>Marker tag</CardTitle>
        <label className="block text-sm">
          Skip any post containing this tag
          <input
            type="text"
            className="mt-1 block w-48 rounded border border-[var(--border)] bg-[var(--bg)] px-3 py-2 font-mono text-sm"
            value={get("nosync_tag")}
            onChange={(e) => set("nosync_tag", e.target.value)}
          />
        </label>
      </Card>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={Object.keys(pending).length === 0}
          className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-[var(--bg)] disabled:opacity-50"
        >
          Save
        </button>
        {saved && <span className="text-xs text-emerald-600 dark:text-emerald-400">Saved</span>}
      </div>
    </div>
  );
}
