'use client';

import { sortHand } from '@cardadda/engine';
import { PlayingCard } from '@/components/table/PlayingCard';
import { cardId, type Card } from '@cardadda/shared';

/**
 * Your fanned hand at the bottom edge. During play, legal cards lift on hover
 * and are clickable; illegal cards are dimmed. During bidding it's shown
 * face-up but inert (so you can plan your bid).
 */
export function YourHand({
  cards,
  legalIds,
  canPlay,
  onPlay,
}: {
  cards: Card[];
  legalIds: Set<string>;
  canPlay: boolean;
  onPlay: (card: Card) => void;
}) {
  const sorted = sortHand(cards);

  return (
    <div className="no-scrollbar flex justify-center overflow-x-auto px-2 pb-1 pt-3">
      <div className="flex -space-x-3">
        {sorted.map((card) => {
          const id = cardId(card);
          const legal = legalIds.has(id);
          return (
            <PlayingCard
              key={id}
              card={card}
              size="lg"
              onClick={canPlay && legal ? () => onPlay(card) : undefined}
              disabled={!canPlay || !legal}
              dim={canPlay && !legal}
            />
          );
        })}
      </div>
    </div>
  );
}
