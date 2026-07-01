/**
 * Deck creation, shuffling, and dealing.
 *
 * The RNG is injectable so tests can run deterministically and the server can,
 * if it ever wants to, plug in a seeded generator for reproducible matches.
 */

import {
  Card,
  CARDS_PER_HAND,
  DECK_SIZE,
  NUM_PLAYERS,
  RANKS,
  SUITS,
} from './types';

/** A random source returning a float in [0, 1), matching `Math.random`. */
export type RNG = () => number;

/** Build a fresh, ordered 52-card deck (4 suits × 13 ranks). */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return deck;
}

/**
 * Return a shuffled copy of `deck` using the Fisher–Yates algorithm.
 * The input array is not mutated. `rng` defaults to Math.random.
 */
export function shuffle(deck: readonly Card[], rng: RNG = Math.random): Card[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return out;
}

/**
 * Deal a 52-card deck into 4 hands of 13, round-robin (seat 0 gets card 0, seat
 * 1 gets card 1, …). Round-robin vs. block dealing is irrelevant once the deck
 * is shuffled, but it mirrors how cards are physically dealt at a table.
 *
 * Returns `hands` indexed by seat: `hands[0..3]`, each a 13-card array.
 * Throws if the deck is not exactly 52 cards.
 */
export function deal(deck: readonly Card[]): Card[][] {
  if (deck.length !== DECK_SIZE) {
    throw new Error(`deal() expects a ${DECK_SIZE}-card deck, got ${deck.length}`);
  }
  const hands: Card[][] = [[], [], [], []];
  deck.forEach((card, i) => {
    hands[i % NUM_PLAYERS]!.push(card);
  });
  return hands;
}

/**
 * Convenience: create → shuffle → deal in one call.
 * Returns 4 hands of 13 cards.
 */
export function createShuffledHands(rng: RNG = Math.random): Card[][] {
  return deal(shuffle(createDeck(), rng));
}

/**
 * Sort a hand for pleasant display: grouped by suit (S, H, D, C) then by rank
 * descending within each suit. Pure — returns a new array. Purely cosmetic;
 * never affects rules.
 */
export function sortHand(hand: readonly Card[]): Card[] {
  const suitOrder: Record<string, number> = { S: 0, H: 1, D: 2, C: 3 };
  return hand.slice().sort((a, b) => {
    if (a.suit !== b.suit) return suitOrder[a.suit]! - suitOrder[b.suit]!;
    return b.rank - a.rank;
  });
}

export { CARDS_PER_HAND };
