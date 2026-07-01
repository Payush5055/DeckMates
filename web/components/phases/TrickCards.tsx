import { PlayingCard } from '@/components/table/PlayingCard';
import { POS_ROTATION, TRICK_SLOT, relativePosition } from '@/lib/seatLayout';
import { cardId, type Seat, type TrickCard } from '@cardadda/shared';

/**
 * The current trick, clustered in the middle of the table. Each card is rotated
 * to indicate who played it (top 180°, left 90°, right −90°, you 0°).
 */
export function TrickCards({ trick, youSeat }: { trick: TrickCard[]; youSeat: Seat }) {
  return (
    <>
      {trick.map((t) => {
        const pos = relativePosition(t.seat, youSeat);
        return (
          <div
            key={cardId(t.card)}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: TRICK_SLOT[pos].left, top: TRICK_SLOT[pos].top }}
          >
            <PlayingCard card={t.card} size="md" rotation={POS_ROTATION[pos]} />
          </div>
        );
      })}
    </>
  );
}
