import { cn } from "@/lib/cn";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--border)] bg-[var(--card)] p-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-3 text-sm font-medium text-[var(--muted)]">{children}</h2>;
}

export function Stat({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: React.ReactNode;
  sublabel?: string;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-1 font-mono text-xl tabular-nums">{value}</div>
      {sublabel && <div className="mt-0.5 text-xs text-[var(--muted)]">{sublabel}</div>}
    </div>
  );
}
