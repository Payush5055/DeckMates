/**
 * 31 (Scat/Blitz) domain types and rule constants.
 *
 * Card/Suit/Rank are the shared "card kernel" primitives used by the other
 * engines — reused from `@cardadda/engine`, not redefined.
 */

export type { Card, Suit, Rank } from '@cardadda/engine';
export { SUITS, RANKS, RANK_LABELS, SUIT_LABELS, cardId } from '@cardadda/engine';

/** Table position, 0..3. 31 tables are always 4 seats (bots fill gaps). */
export type Seat = 0 | 1 | 2 | 3;

export const NUM_PLAYERS = 4;
export const HAND_SIZE = 3;

/** Everyone starts with 3 lives; at 0 you're eliminated. Last alive wins. */
export const STARTING_LIVES = 3;

/** A hand worth exactly this ends the round instantly (including on the deal). */
export const TARGET_VALUE = 31;

/** Three of a kind (same rank, any suits) is a flat 30, regardless of rank. */
export const THREE_OF_A_KIND_VALUE = 30;
