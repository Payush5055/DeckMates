'use client';

import { Overlay } from '@/components/ui/Overlay';
import { SuitDivider } from '@/components/ui/SuitDivider';
import { PlayingCard } from '@/components/table/PlayingCard';
import { POS_COLOR, relativePosition } from '@/lib/seatLayout';
import { cardId, type ThirtyOneRoundResultPayload, type ThirtyOneSeat } from '@cardadda/shared';

/**
 * The reveal: every hand face-up with its computed value, who lost a life —
 * and the double-penalty case called out by name when the knocker was lowest.
 */
export function RevealPanel({
  result,
  youSeat,
}: {
  result: ThirtyOneRoundResultPayload;
  youSeat: ThirtyOneSeat;
}) {
  const seats = ([0, 1, 2, 3] as ThirtyOneSeat[]).filter((s) => result.revealedHands[s] !== null);
  const ordered = [...seats].sort((a, b) => (a === youSeat ? -1 : b === youSeat ? 1 : a - b));

  const title =
    result.reason === 'instant31'
      ? '31! Instant win'
      : `Round ${result.roundNumber} — the reveal`;

  return (
    <Overlay>
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface p-6 shadow-table ring-1 ring-gold/30">
        <h2 className="text-center font-serif text-2xl text-ink">{title}</h2>
        {result.reason === 'instant31' && (
          <p className="mt-1 text-center text-sm text-gold">
            {result.winners31.map((s) => (result.isBot[s] ? 'Bot' : result.playerNames[s])).join(' & ')} hit exactly
            31 — the round ends instantly and everyone else loses a life.
          </p>
        )}
        {result.voided && (
          <p className="mt-1 text-center text-sm text-muted">
            Everyone would have been eliminated — the round is void and will be replayed. No lives lost.
          </p>
        )}
        <SuitDivider className="my-4" />

        <div className="flex flex-col gap-3">
          {ordered.map((seat) => {
            const color = POS_COLOR[relativePosition(seat, youSeat)];
            const hand = result.revealedHands[seat]!;
            const value = result.handValues[seat];
            const lost = result.livesLost[seat] ?? 0;
            const isKnocker = seat === result.knockerSeat;
            const is31 = result.winners31.includes(seat);
            return (
              <div key={seat} className={`rounded-xl p-3 ${lost > 0 ? 'bg-wine/15 ring-1 ring-wine/40' : 'bg-rim/40'}`}>
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <span className="h-4 w-4 shrink-0 rounded-full ring-1 ring-black/30" style={{ backgroundColor: color }} />
                  <span className="truncate text-ink">
                    {result.isBot[seat] ? 'Bot' : result.playerNames[seat]}
                    {seat === youSeat && <span className="ml-1 text-xs text-muted">(you)</span>}
                  </span>
                  {isKnocker && (
                    <span className="rounded-full bg-gold/20 px-2 py-0.5 text-[11px] font-semibold text-gold">
                      Knocked
                    </span>
                  )}
                  <span className={`tabular ml-auto text-lg font-semibold ${is31 ? 'text-gold' : 'text-ink'}`}>
                    {value}
                    {is31 && '!'}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    {hand.map((c) => (
                      <PlayingCard key={cardId(c)} card={c} size="sm" />
                    ))}
                  </div>
                  <div className="ml-auto text-right text-sm">
                    {lost === 2 && (
                      <p className="font-semibold text-wine">Knocked and lost — double penalty (−2 ♥)</p>
                    )}
                    {lost === 1 && <p className="font-semibold text-wine">Lowest hand (−1 ♥)</p>}
                    {lost === 0 && !result.voided && <p className="text-muted">Safe</p>}
                    <p className="tabular mt-0.5 text-muted">
                      {result.livesAfter[seat]! > 0 ? '♥'.repeat(result.livesAfter[seat]!) : 'Eliminated'}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <p className="mt-5 text-center text-sm text-muted">Next round starting automatically…</p>
      </div>
    </Overlay>
  );
}
