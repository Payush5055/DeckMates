'use client';

import { formatTenths } from '@/lib/format';
import { POS_COLOR, relativePosition } from '@/lib/seatLayout';
import type { PublicPlayer, Seat } from '@cardadda/shared';

/**
 * A toggleable, non-modal panel showing every player's live cumulative score.
 * Opened from the "Scores" button in the table toolbar; the player controls
 * whether it stays open. Scores come from `room.scores` (tenths) and update as
 * each round is scored.
 */
export function ScoresPanel({
  players,
  scores,
  youSeat,
  onClose,
}: {
  players: PublicPlayer[];
  scores: number[];
  youSeat: Seat;
  onClose: () => void;
}) {
  // Leaderboard order: highest cumulative score first.
  const rows = [...players].sort((a, b) => (scores[b.seat] ?? 0) - (scores[a.seat] ?? 0));

  return (
    <div className="fixed right-3 top-16 z-40 w-60 rounded-2xl bg-surface p-4 shadow-table ring-1 ring-gold/30">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-serif text-lg text-ink">Scores</h3>
        <button
          onClick={onClose}
          aria-label="Close scores"
          className="rounded-md px-1.5 text-lg leading-none text-muted hover:text-ink"
        >
          ×
        </button>
      </div>
      <ul className="flex flex-col gap-1.5">
        {rows.map((p) => (
          <li key={p.seat} className="flex items-center gap-2 text-sm">
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/30"
              style={{ backgroundColor: POS_COLOR[relativePosition(p.seat, youSeat)] }}
            />
            <span className="flex-1 truncate text-ink" title={p.name}>
              {p.isBot ? 'Bot' : p.name}
              {p.seat === youSeat && <span className="ml-1 text-xs text-muted">(you)</span>}
            </span>
            <span className="tabular font-semibold text-gold">{formatTenths(scores[p.seat] ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
