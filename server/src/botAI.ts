/**
 * Heuristic bot strategy for Callbreak. Deliberately simple — it makes legal,
 * reasonable moves, not expert play. Pure functions over the engine's GameState;
 * the server wraps these with human-like delays.
 */

import {
  Card,
  GameState,
  MAX_BID,
  MIN_BID,
  Seat,
  Suit,
  legalPlays,
  resolveTrick,
} from '@cardadda/engine';

const NON_TRUMP: Suit[] = ['H', 'D', 'C'];

function countBySuit(cards: readonly Card[]): Record<Suit, number> {
  const counts: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of cards) counts[c.suit] += 1;
  return counts;
}

const byRankAsc = (a: Card, b: Card) => a.rank - b.rank;

/**
 * Estimate tricks from hand strength: every spade is a near-certain trick (they
 * are always trump); among off-suits, Aces and Kings count, and a Queen counts
 * only if backed by at least one lower card in the same suit. Clamped to 1–8.
 */
export function chooseBid(hand: readonly Card[]): number {
  const counts = countBySuit(hand);
  let bid = counts.S; // each spade ≈ one trick

  for (const suit of NON_TRUMP) {
    for (const c of hand) {
      if (c.suit !== suit) continue;
      if (c.rank === 14 || c.rank === 13) bid += 1; // Ace, King
      else if (c.rank === 12 && counts[suit] >= 2) bid += 1; // Queen with support
    }
  }
  return Math.max(MIN_BID, Math.min(MAX_BID, bid));
}

/**
 * Pick a card to play. Strategy:
 *  - Leading: lead a short non-trump suit (to draw opponents out) with a low card.
 *  - Following: if the bot still needs tricks, play the lowest card that wins;
 *    otherwise shed the lowest legal card.
 *  - Void of lead suit: trump low to win if tricks are still needed; otherwise
 *    discard the lowest card from the longest non-trump suit.
 */
export function chooseCard(state: GameState, seat: Seat): Card {
  const hand = state.hands[seat]!;
  const trick = state.currentTrick;
  const leadSuit = trick.length > 0 ? trick[0]!.card.suit : null;
  const legal = legalPlays(hand, trick);
  if (legal.length <= 1) return legal[0] ?? hand[0]!;

  const bid = state.bids[seat] ?? MIN_BID;
  const needMore = state.tricksWon[seat]! < bid;
  const counts = countBySuit(hand);

  // Would this card currently win the trick (against cards played so far)?
  const wins = (card: Card) => resolveTrick([...trick, { seat, card }]) === seat;

  // Leading a fresh trick.
  if (leadSuit === null) {
    const nonSpades = legal.filter((c) => c.suit !== 'S');
    const pool = nonSpades.length > 0 ? nonSpades : legal;
    let shortest = pool[0]!;
    for (const c of pool) if (counts[c.suit] < counts[shortest.suit]) shortest = c;
    return legal
      .filter((c) => c.suit === shortest.suit)
      .sort(byRankAsc)[0]!;
  }

  // Following / void: try to win cheaply if the bot still needs tricks.
  if (needMore) {
    const winners = legal.filter(wins).sort(byRankAsc);
    if (winners.length > 0) return winners[0]!;
  }

  // Not winning: shed. When void of the lead suit, dump from the longest
  // non-trump suit to preserve trumps; otherwise just the lowest legal card.
  const isVoid = !hand.some((c) => c.suit === leadSuit);
  if (isVoid) {
    const nonTrump = legal.filter((c) => c.suit !== 'S');
    if (nonTrump.length > 0) {
      let longest = nonTrump[0]!;
      for (const c of nonTrump) if (counts[c.suit] > counts[longest.suit]) longest = c;
      return legal
        .filter((c) => c.suit === longest.suit)
        .sort(byRankAsc)[0]!;
    }
  }
  return [...legal].sort(byRankAsc)[0]!;
}
