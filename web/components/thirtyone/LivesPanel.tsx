'use client';

import { POS_COLOR, relativePosition } from '@/lib/seatLayout';
import type { ThirtyOnePublicPlayer, ThirtyOneSeat } from '@cardadda/shared';

/**
 * The "Scores" toggle for 31: lives remaining per player, with eliminated
 * players clearly marked as out. Same button/panel pattern as the other games.
 */
export function LivesPanel({
  players,
  youSeat,
  onClose,
}: {
  players: ThirtyOnePublicPlayer[];
  youSeat: ThirtyOneSeat;
  onClose: () => void;
}) {
  const rows = [...players].sort((a, b) => b.lives - a.lives || a.seat - b.seat);

  return (
    <div className="fixed right-3 top-16 z-40 w-64 rounded-2xl bg-surface p-4 shadow-table ring-1 ring-gold/30">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-serif text-lg text-ink">Lives</h3>
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
          <li key={p.seat} className={`flex items-center gap-2 text-sm ${p.eliminated ? 'opacity-60' : ''}`}>
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/30"
              style={{ backgroundColor: POS_COLOR[relativePosition(p.seat, youSeat)] }}
            />
            <span className="flex-1 truncate text-ink">
              {p.isBot ? 'Bot' : p.name}
              {p.seat === youSeat && <span className="ml-1 text-xs text-muted">(you)</span>}
            </span>
            {p.eliminated ? (
              <span className="rounded-full bg-wine/25 px-2 py-0.5 text-xs font-semibold text-wine">Out</span>
            ) : (
              <span className="tabular font-semibold text-gold">{'♥'.repeat(p.lives)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
