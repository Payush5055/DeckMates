'use client';

import { rankByLowest } from '@cardadda/crazy8-engine';
import { POS_COLOR, relativePosition } from '@/lib/seatLayout';
import type { Crazy8PublicPlayer, Crazy8RoundResultPayload, Crazy8Seat } from '@cardadda/shared';

/**
 * Toggleable panel (same "Scores" button pattern as Callbreak): a round-by-
 * round history table, then a live "current standings" list ranked lowest
 * total first (Crazy 8s has a single winner, not one loser), updating as
 * rounds complete.
 */
export function ScoresPanel({
  players,
  scores,
  roundHistory,
  youSeat,
  onClose,
}: {
  players: Crazy8PublicPlayer[];
  scores: number[];
  roundHistory: Crazy8RoundResultPayload[];
  youSeat: Crazy8Seat;
  onClose: () => void;
}) {
  const standings = rankByLowest(scores);

  const nameFor = (seat: number) => {
    const p = players.find((pl) => pl.seat === seat);
    if (!p) return `Seat ${seat}`;
    return p.isBot ? 'Bot' : p.name;
  };

  return (
    <div className="fixed right-3 top-16 z-40 w-72 max-h-[70vh] overflow-y-auto rounded-2xl bg-surface p-4 shadow-table ring-1 ring-gold/30">
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

      {/* Round-by-round history */}
      {roundHistory.length > 0 && (
        <div className="mb-4">
          <p className="mb-1.5 text-xs uppercase tracking-wider text-muted">Round history</p>
          <div className="flex flex-col gap-2">
            {roundHistory.map((r) => (
              <div key={r.roundNumber} className="rounded-lg bg-rim/40 p-2 text-xs">
                <div className="mb-1 flex items-center justify-between">
                  <span className="tabular text-muted">Round {r.roundNumber}</span>
                  <span className="truncate text-gold">{nameFor(r.winnerSeat)} won</span>
                </div>
                <div className="flex flex-col gap-0.5">
                  {r.playerNames.map((_, seat) => (
                    <div key={seat} className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 truncate text-ink/80">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-black/30"
                          style={{ backgroundColor: POS_COLOR[relativePosition(seat as Crazy8Seat, youSeat, r.playerNames.length)] }}
                        />
                        {r.isBot[seat] ? 'Bot' : r.playerNames[seat]}
                      </span>
                      <span className="tabular text-ink">
                        {seat === r.winnerSeat ? '0' : `+${r.pointsThisRound[seat] ?? 0}`} · {r.cumulativeScores[seat] ?? 0}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Current standings, ranked lowest-first (live) */}
      <p className="mb-1.5 text-xs uppercase tracking-wider text-muted">Current standings</p>
      <ul className="flex flex-col gap-1.5">
        {standings.map((s) => (
          <li key={s.seat} className="flex items-center gap-2 text-sm">
            <span className="tabular w-5 text-gold">{s.rank}</span>
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/30"
              style={{ backgroundColor: POS_COLOR[relativePosition(s.seat as Crazy8Seat, youSeat, players.length)] }}
            />
            <span className="flex-1 truncate text-ink">
              {nameFor(s.seat)}
              {s.seat === youSeat && <span className="ml-1 text-xs text-muted">(you)</span>}
            </span>
            <span className="tabular font-semibold text-gold">{s.total}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
