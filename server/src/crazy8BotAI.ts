/**
 * Heuristic bot strategy for Crazy 8s. Deliberately simple — legal, reasonable
 * moves, not expert play. Pure functions over the engine's GameState; the
 * server wraps these with human-like delays.
 */

import { legalPlays, topCard, type Card, type GameState, type Suit } from '@cardadda/crazy8-engine';

const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C'];

function countBySuit(hand: readonly Card[]): Record<Suit, number> {
  const counts: Record<Suit, number> = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of hand) counts[c.suit] += 1;
  return counts;
}

/**
 * Pick a card to play, or `null` if the bot has no legal play and must draw.
 * Prefers a non-8 legal card when one exists, saving wild 8s in hand for when
 * they're genuinely needed (no other legal card).
 */
export function chooseCard(state: GameState, seat: number): Card | null {
  const hand = state.hands[seat]!;
  const legal = legalPlays(hand, topCard(state), state.requiredSuit);
  if (legal.length === 0) return null;
  const nonWild = legal.filter((c) => c.rank !== 8);
  return nonWild[0] ?? legal[0]!;
}

/**
 * Declare whichever suit the bot holds the most of in its remaining hand
 * (after the 8 being played is removed) — keeps future turns easiest for it.
 */
export function chooseSuit(handAfterPlayingEight: readonly Card[]): Suit {
  const counts = countBySuit(handAfterPlayingEight);
  let best: Suit = SUITS[0]!;
  for (const s of SUITS) if (counts[s] > counts[best]) best = s;
  return best;
}
