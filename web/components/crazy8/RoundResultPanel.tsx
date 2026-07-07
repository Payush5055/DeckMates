'use client';

import { Overlay } from '@/components/ui/Overlay';
import { SuitDivider } from '@/components/ui/SuitDivider';
import { POS_COLOR, relativePosition } from '@/lib/seatLayout';
import type { Crazy8RoundResultPayload, Crazy8Seat } from '@cardadda/shared';

/**
 * Between-round results. Scores are public — everyone sees everyone's points
 * this round and running cumulative total. The round's winner scored 0.
 */
export function RoundResultPanel({
  result,
  youSeat,
  numPlayers,
}: {
  result: Crazy8RoundResultPayload;
  youSeat: Crazy8Seat;
  numPlayers: number;
}) {
  const seats = Array.from({ length: numPlayers }, (_, i) => i as Crazy8Seat);
  const ordered = [...seats].sort((a, b) => (a === youSeat ? -1 : b === youSeat ? 1 : a - b));

  return (
    <Overlay>
      <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-table ring-1 ring-gold/30">
        <h2 className="text-center font-serif text-2xl text-ink">Round {result.roundNumber} complete</h2>
        <p className="mt-1 text-center text-sm text-gold">
          {result.isBot[result.winnerSeat] ? 'Bot' : result.playerNames[result.winnerSeat]} emptied their hand
        </p>
        <SuitDivider className="my-4" />

        <div className="grid grid-cols-[1.6fr_repeat(2,1fr)] items-center gap-y-2 text-center text-sm">
          <span className="text-left text-muted">Player</span>
          <span className="text-muted">Round</span>
          <span className="text-muted">Total</span>

          {ordered.map((seat) => {
            const color = POS_COLOR[relativePosition(seat, youSeat, numPlayers)];
            const isWinner = seat === result.winnerSeat;
            const points = result.pointsThisRound[seat] ?? 0;
            return (
              <div key={seat} className="contents">
                <div className="flex items-center gap-2 text-left">
                  <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/30" style={{ backgroundColor: color }} />
                  <span className="truncate text-ink">
                    {result.isBot[seat] ? 'Bot' : result.playerNames[seat]}
                    {seat === youSeat && <span className="ml-1 text-xs text-muted">(you)</span>}
                  </span>
                </div>
                <span className={`tabular ${isWinner ? 'text-emerald-300' : 'text-ink'}`}>
                  {isWinner ? '0' : `+${points}`}
                </span>
                <span className="tabular font-semibold text-gold">{result.cumulativeScores[seat] ?? 0}</span>
              </div>
            );
          })}
        </div>

        <p className="mt-5 text-center text-sm text-muted">Next round starting automatically…</p>
      </div>
    </Overlay>
  );
}
