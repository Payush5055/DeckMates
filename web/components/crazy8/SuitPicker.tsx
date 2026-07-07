'use client';

import { Overlay } from '@/components/ui/Overlay';
import { SUIT_LABELS, type Crazy8Suit } from '@cardadda/shared';

const SUITS: Crazy8Suit[] = ['S', 'H', 'D', 'C'];
const RED_SUITS = new Set(['H', 'D']);

/**
 * Shown the moment an 8 is about to be played — from hand, or one that was
 * just drawn and became playable. The player picks the suit that becomes
 * required next, independent of the 8's own printed suit.
 */
export function SuitPicker({ onChoose }: { onChoose: (suit: Crazy8Suit) => void }) {
  return (
    <Overlay>
      <div className="w-full max-w-xs rounded-2xl bg-surface p-6 text-center shadow-table ring-1 ring-gold/30">
        <h2 className="font-serif text-xl text-ink">Wild 8 — declare a suit</h2>
        <p className="mt-1 text-sm text-muted">The next play must match this suit.</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          {SUITS.map((s) => (
            <button
              key={s}
              onClick={() => onChoose(s)}
              className={`flex h-16 items-center justify-center rounded-xl bg-rim/60 text-3xl ring-1 ring-gold/40 transition hover:bg-gold hover:text-rim ${
                RED_SUITS.has(s) ? 'text-[#C9524A]' : 'text-ink'
              }`}
            >
              {SUIT_LABELS[s]}
            </button>
          ))}
        </div>
      </div>
    </Overlay>
  );
}
