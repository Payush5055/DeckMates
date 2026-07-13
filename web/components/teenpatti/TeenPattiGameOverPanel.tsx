'use client';

import { Overlay } from '@/components/ui/Overlay';
import { Button } from '@/components/ui/Button';
import { SuitDivider } from '@/components/ui/SuitDivider';
import { PlayingCard } from '@/components/table/PlayingCard';
import type { TeenPattiCard, TeenPattiGameOverPayload, TeenPattiSeat } from '@cardadda/shared';

function CardRow({ cards }: { cards: TeenPattiCard[] }) {
  return (
    <div className="flex -space-x-2">
      {cards.map((card, i) => (
        <PlayingCard key={`${card.suit}${card.rank}${i}`} card={card} size="sm" />
      ))}
    </div>
  );
}

export function TeenPattiGameOverPanel({
  result,
  youSeat,
  onPlayAgain,
  onHome,
}: {
  result: TeenPattiGameOverPayload;
  youSeat: TeenPattiSeat;
  onPlayAgain: () => void;
  onHome: () => void;
}) {
  return (
    <Overlay>
      <div className="w-full max-w-2xl rounded-2xl bg-surface p-6 shadow-table ring-1 ring-gold/30">
        <h2 className="text-center font-serif text-3xl text-ink">Hand complete</h2>
        <p className="mt-1 text-center text-sm text-muted">
          Pot {result.result.pot} · {result.result.variant.toUpperCase()}
        </p>
        <SuitDivider className="my-4" />

        <ul className="flex flex-col gap-3">
          {result.standings.map((standing) => {
            const cards = result.result.revealedHands[standing.seat] ?? [];
            const label = result.result.handLabels[standing.seat] ?? '';
            const isYou = standing.seat === youSeat;
            const isWinner = standing.rank === 1;
            return (
              <li
                key={standing.seat}
                className={`rounded-xl px-4 py-3 ${isWinner ? 'bg-gold/15 ring-1 ring-gold/50' : 'bg-rim/40'}`}
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="text-ink">
                    <span className="font-medium">{standing.isBot ? 'Bot' : standing.name}</span>
                    {isYou && <span className="ml-2 text-xs text-muted">(you)</span>}
                    {isWinner && <span className="ml-2 text-sm text-gold">Winner</span>}
                  </div>
                  <span className="text-sm text-muted">{label}</span>
                </div>
                <CardRow cards={cards} />
              </li>
            );
          })}
        </ul>

        {result.result.showdown && (
          <p className="mt-4 text-center text-sm text-muted">
            {result.result.showdown.kind === 'show' ? 'Final show' : 'Winning side show'} decided the hand
            {result.result.showdown.tie ? ' on a tie-break' : ''}.
          </p>
        )}

        <div className="mt-6 flex justify-center gap-3">
          <Button onClick={onPlayAgain}>Play again</Button>
          <Button variant="ghost" onClick={onHome}>
            Back to home
          </Button>
        </div>
      </div>
    </Overlay>
  );
}
