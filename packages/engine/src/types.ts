/**
 * Core Callbreak domain types and rule constants.
 *
 * This module is deliberately pure data — no logic, no framework imports — so it
 * can be shared unchanged by the rule engine, the Socket.io server, and the UI.
 */

/** Suit codes: (S)pades, (H)earts, (D)iamonds, (C)lubs. */
export type Suit = 'S' | 'H' | 'D' | 'C';

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'] as const;

/**
 * Rank as a numeric strength so cards compare with plain `>`.
 * 2..10 are face value; 11 = Jack, 12 = Queen, 13 = King, 14 = Ace (Ace high).
 */
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export const RANKS: readonly Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14] as const;

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

/** Table position, 0..3. The engine is seat-based; the server maps players → seats. */
export type Seat = 0 | 1 | 2 | 3;

export const SEATS: readonly Seat[] = [0, 1, 2, 3] as const;

/** Spades are ALWAYS trump in Callbreak — they beat every other suit in a trick. */
export const TRUMP_SUIT: Suit = 'S';

export const NUM_PLAYERS = 4;
export const CARDS_PER_HAND = 13;
export const DECK_SIZE = NUM_PLAYERS * CARDS_PER_HAND; // 52

/** A full Callbreak match is 5 rounds; each round plays out all 13 tricks. */
export const TOTAL_ROUNDS = 5;

/**
 * Bidding range for this build. Classic Callbreak has NO nil/zero bid, so the
 * minimum is 1. We cap the maximum at 8 (a hand can theoretically make 13, but
 * bidding above 8 is vanishingly rare and the product brief fixes the range).
 */
export const MIN_BID = 1;
export const MAX_BID = 8;

/** Human-readable rank labels for display / logging (not used in comparisons). */
export const RANK_LABELS: Readonly<Record<Rank, string>> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

export const SUIT_LABELS: Readonly<Record<Suit, string>> = {
  S: '♠', // ♠
  H: '♥', // ♥
  D: '♦', // ♦
  C: '♣', // ♣
};

/** Stable string id for a card, handy as a React key or Map key. */
export function cardId(card: Card): string {
  return `${card.suit}${card.rank}`;
}

/** Advance to the next seat clockwise (0 → 1 → 2 → 3 → 0). */
export function nextSeat(seat: Seat): Seat {
  return ((seat + 1) % NUM_PLAYERS) as Seat;
}
