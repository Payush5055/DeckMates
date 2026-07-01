import { RANK_LABELS, SUIT_LABELS, type Card } from '@cardadda/shared';

const RED_SUITS = new Set(['H', 'D']);

interface Props {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  dim?: boolean;
  size?: 'sm' | 'md' | 'lg';
  rotation?: number;
}

const SIZES = {
  sm: 'h-14 w-10 text-xs',
  md: 'h-20 w-14 text-sm',
  lg: 'h-24 w-16 text-base',
};

/** A face-up playing card. Red for ♥/♦, ink for ♠/♣. */
export function PlayingCard({ card, onClick, disabled, dim, size = 'md', rotation = 0 }: Props) {
  const red = RED_SUITS.has(card.suit);
  const rank = RANK_LABELS[card.rank];
  const suit = SUIT_LABELS[card.suit];
  const interactive = Boolean(onClick) && !disabled;

  return (
    <button
      type="button"
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      style={{ transform: rotation ? `rotate(${rotation}deg)` : undefined }}
      className={`relative select-none rounded-lg border border-black/10 bg-[#FBF7EC] shadow-card transition ${
        SIZES[size]
      } ${red ? 'text-[#B4322B]' : 'text-[#1A1A1A]'} ${
        interactive ? 'cursor-pointer hover:-translate-y-2 hover:shadow-lg' : 'cursor-default'
      } ${dim ? 'opacity-45' : ''}`}
    >
      <span className="tabular absolute left-1 top-0.5 font-semibold leading-none">{rank}</span>
      <span className="absolute left-1 top-4 text-[0.9em] leading-none" aria-hidden>
        {suit}
      </span>
      <span className="absolute inset-0 flex items-center justify-center text-[1.7em]" aria-hidden>
        {suit}
      </span>
      <span className="tabular absolute bottom-0.5 right-1 rotate-180 font-semibold leading-none">{rank}</span>
    </button>
  );
}
