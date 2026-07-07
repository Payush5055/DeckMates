/**
 * Crazy 8s domain types and rule constants.
 *
 * Card/Suit/Rank/Seat are the same "card kernel" primitives used by the
 * Callbreak engine — reused directly from `@cardadda/engine` rather than
 * redefined, since a standard 52-card deck is identical across both games.
 */

export type { Card, Suit, Rank } from '@cardadda/engine';
export { SUITS, RANKS, RANK_LABELS, SUIT_LABELS, cardId } from '@cardadda/engine';

/** Table position, 0..3 — the same range as Callbreak's, just not all filled. */
export type Seat = 0 | 1 | 2 | 3;

/** Crazy 8s tables seat between 2 and 4 players (any count in that range). */
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

/** The wild rank: an 8 is always playable and lets its player declare a suit. */
export const WILD_RANK = 8;

/** Cumulative score at which the match ends immediately (>= this ends it). */
export const GAME_END_THRESHOLD = 100;

/** Card point values used when scoring a round's leftover hands. */
export const EIGHT_POINTS = 50;
export const FACE_CARD_POINTS = 10; // Jack, Queen, King
export const ACE_POINTS = 1;

/**
 * Hand size by player count: 7 cards for a 2-player game, 5 cards otherwise
 * (3 or 4 players) — the standard Crazy Eights convention.
 */
export function handSizeFor(numPlayers: number): number {
  return numPlayers <= 2 ? 7 : 5;
}

/** Advance to the next seat clockwise, wrapping at `numPlayers` (not always 4). */
export function nextSeat(seat: Seat, numPlayers: number): Seat {
  return (((seat + 1) % numPlayers) as Seat);
}
