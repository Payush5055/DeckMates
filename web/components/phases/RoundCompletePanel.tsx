'use client';

import { Overlay } from '@/components/ui/Overlay';
import { SuitDivider } from '@/components/ui/SuitDivider';
import { formatSignedTenths, formatTenths } from '@/lib/format';
import { POS_COLOR, relativePosition } from '@/lib/seatLayout';
import type { RoundResultPayload, Seat } from '@cardadda/shared';

/**
 * Between-round results. Scores are public — everyone sees everyone's bid,
 * tricks won, points this round (decimal, e.g. "3.2"), and running total.
 * Players are shown by seat color + username (or "Bot"), with a "you" marker.
 */
export function RoundCompletePanel({
  result,
  youSeat,
}: {
  result: RoundResultPayload;
  youSeat: Seat;
}) {
  const seats = [0, 1, 2, 3] as Seat[];
  // You first, then the rest by seat order.
  const ordered = [...seats].sort((a, b) => (a === youSeat ? -1 : b === youSeat ? 1 : a - b));

  return (
    <Overlay>
      <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-table ring-1 ring-gold/30">
        <h2 className="text-center font-serif text-2xl text-ink">Round {result.roundNumber} complete</h2>
        <SuitDivider className="my-4" />

        <div className="grid grid-cols-[1.4fr_repeat(4,1fr)] items-center gap-y-2 text-center text-sm">
          <span className="text-left text-muted">Player</span>
          <span className="text-muted">Bid</span>
          <span className="text-muted">Won</span>
          <span className="text-muted">Round</span>
          <span className="text-muted">Total</span>

          {ordered.map((seat) => {
            const color = POS_COLOR[relativePosition(seat, youSeat)];
            const scored = result.scoreTenths[seat]!;
            const made = result.tricksWon[seat]! >= result.bids[seat]!;
            return (
              <div key={seat} className="contents">
                <div className="flex items-center gap-2 text-left">
                  <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/30" style={{ backgroundColor: color }} />
                  <span className="truncate text-ink" title={result.playerNames[seat]}>
                    {result.isBot[seat] ? 'Bot' : result.playerNames[seat]}
                    {seat === youSeat && <span className="ml-1 text-xs text-muted">(you)</span>}
                  </span>
                </div>
                <span className="tabular text-ink">{result.bids[seat]}</span>
                <span className="tabular text-ink">{result.tricksWon[seat]}</span>
                <span className={`tabular ${made ? 'text-emerald-300' : 'text-wine'}`}>
                  {formatSignedTenths(scored)}
                </span>
                <span className="tabular font-semibold text-gold">
                  {formatTenths(result.cumulativeTenths[seat]!)}
                </span>
              </div>
            );
          })}
        </div>

        <p className="mt-5 text-center text-sm text-muted">Next round starting automatically…</p>
      </div>
    </Overlay>
  );
}
