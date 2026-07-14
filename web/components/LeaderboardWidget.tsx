'use client';

/**
 * Live leaderboard, ranked by permanent wallet balance (all-time, never
 * resets). Two densities from one fetch/render core:
 *
 *   • compact — top 3 only; sits in the home hero where "Play now" used to be.
 *   • full    — every account; the /leaderboard page.
 *
 * "Live" is real, not implied: the list re-fetches on an interval, the dot by
 * the title breathes, and the balance figures carry a subtle periodic tick
 * (see globals.css) so the board reads as a feed rather than a snapshot.
 */

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ordinal } from '@/lib/format';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';
const REFRESH_MS = 10_000;

export interface LeaderboardEntry {
  rank: number;
  username: string;
  balance: number;
}

/** Same palette family as the table seats, hashed off the username. */
const AVATAR_COLORS = ['#C9A24B', '#8B2635', '#3C3489', '#0F6E56', '#6B4E16', '#29607D'];

function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]!;
}

export function useLeaderboard(limit?: number): { entries: LeaderboardEntry[] | null; error: boolean } {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      const url = limit ? `${SOCKET_URL}/api/leaderboard?limit=${limit}` : `${SOCKET_URL}/api/leaderboard`;
      fetch(url)
        .then((r) => r.json())
        .then((data: { entries?: LeaderboardEntry[] }) => {
          if (cancelled) return;
          setEntries(data.entries ?? []);
          setError(false);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        });
    };
    load();
    const interval = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [limit]);

  return { entries, error };
}

export function LiveTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="live-dot h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
      <span className="text-sm uppercase tracking-[0.2em] text-gold/90">{children}</span>
    </div>
  );
}

export function LeaderboardRow({ entry, index, highlight }: { entry: LeaderboardEntry; index: number; highlight?: boolean }) {
  return (
    <li
      className={`flex items-center gap-3 rounded-xl px-3 py-2 ${
        highlight ? 'bg-gold/15 ring-1 ring-gold/40' : 'bg-rim/40 ring-1 ring-ink/10'
      }`}
    >
      <span className="tabular w-8 shrink-0 text-sm font-semibold text-gold">{ordinal(entry.rank)}</span>
      <span
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-serif text-sm text-ink ring-1 ring-black/30"
        style={{ backgroundColor: avatarColor(entry.username) }}
        aria-hidden
      >
        {entry.username.slice(0, 1).toUpperCase()}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-ink" title={entry.username}>
        {entry.username}
      </span>
      <span
        className="balance-tick tabular shrink-0 text-sm font-semibold text-gold"
        style={{ animationDelay: `${(index % 5) * 0.7}s` }}
      >
        ₹{entry.balance.toLocaleString('en-IN')}
      </span>
    </li>
  );
}

/** Compact top-3 card for the home hero. */
export function LeaderboardWidget() {
  const { entries, error } = useLeaderboard(3);

  return (
    <div className="mt-7 w-full max-w-sm rounded-2xl bg-rim/50 p-4 ring-1 ring-gold/25">
      <div className="flex items-center justify-between">
        <LiveTitle>Leaderboard</LiveTitle>
      </div>

      {error && <p className="mt-3 text-sm text-muted">Leaderboard is warming up…</p>}
      {!error && entries === null && <p className="mt-3 text-sm text-muted">Loading…</p>}
      {!error && entries?.length === 0 && (
        <p className="mt-3 text-sm text-muted">No players yet — be the first on the board.</p>
      )}

      {!!entries?.length && (
        <ol className="mt-3 flex flex-col gap-2">
          {entries.map((entry, i) => (
            <LeaderboardRow key={entry.username} entry={entry} index={i} highlight={entry.rank === 1} />
          ))}
        </ol>
      )}

      <Link
        href="/leaderboard"
        className="mt-3 inline-flex items-center gap-1 text-sm text-gold transition hover:brightness-125"
      >
        View full leaderboard <span aria-hidden>→</span>
      </Link>
    </div>
  );
}
