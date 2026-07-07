import { SUIT_LABELS } from '@cardadda/shared';
import type { Crazy8Suit } from '@cardadda/shared';

const RED_SUITS = new Set(['H', 'D']);

/**
 * "Suit in play" badge near the discard pile. Shows the currently REQUIRED
 * suit — which, after an 8 is played, is the declared suit and may differ
 * from the literal top card's own printed suit.
 */
export function SuitBadge({ suit }: { suit: Crazy8Suit }) {
  const red = RED_SUITS.has(suit);
  return (
    <div className="flex items-center gap-1.5 rounded-full bg-rim/85 px-3 py-1 shadow-card ring-1 ring-gold/40">
      <span className="text-[10px] uppercase tracking-widest text-muted">Suit in play</span>
      <span className={`text-lg leading-none ${red ? 'text-[#C9524A]' : 'text-ink'}`}>{SUIT_LABELS[suit]}</span>
    </div>
  );
}
