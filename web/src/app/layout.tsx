import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Crosspost",
  description: "Sync posts across X, Mastodon, and Bluesky",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b border-[var(--border)]">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-sm font-semibold tracking-tight">
              crosspost
            </Link>
            <nav className="flex items-center gap-6 text-sm text-[var(--muted)]">
              <Link className="hover:text-[var(--fg)]" href="/">Home</Link>
              <Link className="hover:text-[var(--fg)]" href="/posts">Posts</Link>
              <Link className="hover:text-[var(--fg)]" href="/settings">Settings</Link>
              <Link className="hover:text-[var(--fg)]" href="/logs">Logs</Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
