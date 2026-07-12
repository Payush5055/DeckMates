/**
 * Heuristic bot strategy for 31. Legal, reasonable moves — not expert play.
 * Pure functions over the engine's GameState; the server adds human pacing.
 */

import { handValue, type Card, type GameState, type Seat } from '@cardadda/thirtyone-engine';

/** Knock once the hand is at least this strong (and nobody else has). */
const KNOCK_THRESHOLD = 27;

/** Best 3-card keep from 4 cards: value kept, and which card to shed. */
export function bestKeep(four: readonly Card[]): { value: number; discard: Card } {
  let best = { value: -1, discard: four[0]! };
  for (let i = 0; i < four.length; i++) {
    const kept = four.filter((_, j) => j !== i);
    const v = handValue(kept);
    if (v > best.value) best = { value: v, discard: four[i]! };
  }
  return best;
}

/** Decide the whole turn: knock, or which pile to draw from. */
export function chooseTurn(state: GameState, seat: Seat): { action: 'knock' } | { action: 'draw'; source: 'pile' | 'discard' } {
  const hand = state.hands[seat]!;
  const current = handValue(hand);

  if (state.knocker === null && current >= KNOCK_THRESHOLD) return { action: 'knock' };

  // Take the face-up discard only when it strictly improves the hand.
  const top = state.discardPile[state.discardPile.length - 1];
  if (top && bestKeep([...hand, top]).value > current) {
    return { action: 'draw', source: 'discard' };
  }
  // Fall back to the discard pile if the face-down pile is truly exhausted.
  if (state.drawPile.length === 0 && state.discardPile.length <= 1 && top) {
    return { action: 'draw', source: 'discard' };
  }
  return { action: 'draw', source: 'pile' };
}

/** After drawing (4 cards in hand): shed the card that keeps the best 3. */
export function chooseDiscard(state: GameState, seat: Seat): Card {
  return bestKeep(state.hands[seat]!).discard;
}
