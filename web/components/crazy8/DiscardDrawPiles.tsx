import { PlayingCard } from '@/components/table/PlayingCard';
import { CardBack } from '@/components/table/CardBack';
import { SuitBadge } from './SuitBadge';
import type { Crazy8Card, Crazy8Suit } from '@cardadda/shared';

/**
 * The discard pile (top card face-up) and draw pile (face-down stack) shown
 * together at the center of the table, plus the "Suit in play" badge.
 */
export function DiscardDrawPiles({
  topCard,
  requiredSuit,
  drawPileCount,
}: {
  topCard: Crazy8Card | null;
  requiredSuit: Crazy8Suit | null;
  drawPileCount: number;
}) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-6">
      {/* Draw pile — face-down stack, count only. */}
      <div className="relative flex flex-col items-center gap-1.5">
        <div className="relative h-20 w-14">
          {drawPileCount > 0 ? (
            <>
              <div className="absolute inset-0 translate-x-0.5 translate-y-0.5 opacity-60">
                <CardBack size="md" />
              </div>
              <div className="absolute inset-0">
                <CardBack size="md" />
              </div>
            </>
          ) : (
            <div className="flex h-20 w-14 items-center justify-center rounded-lg border border-dashed border-gold/30 text-xs text-muted">
              empty
            </div>
          )}
        </div>
        <span className="tabular rounded-md bg-rim/80 px-2 py-0.5 text-xs text-ink shadow-card">
          {drawPileCount} left
        </span>
      </div>

      {/* Discard pile — literal top card, face-up. */}
      <div className="flex flex-col items-center gap-1.5">
        {topCard ? <PlayingCard card={topCard} size="md" /> : <div className="h-20 w-14" />}
        {requiredSuit && <SuitBadge suit={requiredSuit} />}
      </div>
    </div>
  );
}
