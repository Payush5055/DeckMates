'use client';

import { Button } from '@/components/ui/Button';
import { Overlay } from '@/components/ui/Overlay';
import { SuitDivider } from '@/components/ui/SuitDivider';
import { ordinal } from '@/lib/format';
import { POS_COLOR, relativePosition } from '@/lib/seatLayout';
import type { ThirtyOneGameOverPayload, ThirtyOneSeat } from '@cardadda/shared';

/** Final standings: the last player with lives wins; others ranked by how long
 * they survived. */
export function GameOverPanel({
  result,
  youSeat,
  onPlayAgain,
  onHome,
}: {
  result: ThirtyOneGameOverPayload;
  youSeat: ThirtyOneSeat;
  onPlayAgain: () => void;
  onHome: () => void;
}) {
  const topRank = Math.min(...result.standings.map((s) => s.rank));

  return (
    <Overlay>
      <div className="w-full max-w-lg rounded-2xl bg-surface p-6 shadow-table ring-1 ring-gold/30">
        <h2 className="text-center font-serif text-3xl text-ink">Match complete</h2>
        <p className="mt-1 text-center text-sm text-muted">Last player with lives standing wins</p>
        <SuitDivider className="my-4" />

        <ul className="flex flex-col gap-2">
          {result.standings.map((s) => {
            const color = POS_COLOR[relativePosition(s.seat, youSeat)];
            const isYou = s.seat === youSeat;
            const isWinner = s.rank === topRank;
            return (
              <li
                key={s.seat}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 ${
                  isWinner ? 'bg-gold/15 ring-1 ring-gold/50' : 'bg-rim/40'
                }`}
              >
                <span className="tabular w-10 text-lg font-semibold text-gold">{ordinal(s.rank)}</span>
                <span className="h-6 w-6 shrink-0 rounded-full ring-1 ring-black/30" style={{ backgroundColor: color }} />
                <span className="flex-1 truncate text-ink" title={s.name}>
                  {s.isBot ? 'Bot' : s.name}
                  {isYou && <span className="ml-1 text-xs text-muted">(you)</span>}
                  {isWinner && <span className="ml-2 text-sm text-gold">👑 Winner</span>}
                </span>
                <span className="tabular font-semibold text-ink">
                  {s.lives > 0 ? '♥'.repeat(s.lives) : 'Out'}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-6 flex justify-center gap-3">
          <Button variant="primary" onClick={onPlayAgain}>
            Play again
          </Button>
          <Button variant="ghost" onClick={onHome}>
            Back to home
          </Button>
        </div>
      </div>
    </Overlay>
  );
}
