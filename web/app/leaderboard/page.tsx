'use client';

/** Full all-time leaderboard: every account ranked by permanent balance. */

import { SuitDivider } from '@/components/ui/SuitDivider';
import { LeaderboardRow, LiveTitle, useLeaderboard } from '@/components/LeaderboardWidget';

export default function LeaderboardPage() {
  const { entries, error } = useLeaderboard();

  return (
    <main className="mx-auto max-w-2xl px-4 pb-16">
      <section className="mt-2 rounded-2xl bg-surface px-6 py-6 shadow-table ring-1 ring-gold/20">
        <LiveTitle>Live · all-time</LiveTitle>
        <h1 className="mt-2 font-serif text-3xl text-ink">Leaderboard</h1>
        <p className="mt-1 text-sm text-muted">
          Every player, ranked by permanent balance. Winnings from all four games count — this board never resets.
        </p>
      </section>

      <SuitDivider className="my-6" />

      {error && <p className="text-wine">Could not reach the game server.</p>}
      {!error && entries === null && <p className="text-muted">Loading…</p>}
      {!error && entries?.length === 0 && (
        <p className="text-muted">No players yet — play a game and the board comes alive.</p>
      )}

      {!!entries?.length && (
        <ol className="flex flex-col gap-2">
          {entries.map((entry, i) => (
            <LeaderboardRow key={entry.username} entry={entry} index={i} highlight={entry.rank <= 3} />
          ))}
        </ol>
      )}
    </main>
  );
}
