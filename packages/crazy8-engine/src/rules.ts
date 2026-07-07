/**
 * Legal-move validation for Crazy 8s.
 *
 * ── Rule ─────────────────────────────────────────────────────────────────────
 * A card is playable if:
 *   • its rank is 8 (wild — always playable, any suit, any time), OR
 *   • its suit matches the currently REQUIRED suit, OR
 *   • its rank matches the literal top discard card's rank.
 *
 * The "required suit" is tracked separately from the literal top card because
 * they can differ: playing an 8 lets its player declare any suit as required,
 * regardless of the 8's own printed suit. When the top card is NOT an 8, the
 * required suit is simply that card's own suit (ordinary suit-or-rank match).
 * ────────────────────────────────────────────────────────────────────────────
 */

import { WILD_RANK, type Card, type Suit } from './types';

function handHas(hand: readonly Card[], card: Card): boolean {
  return hand.some((c) => c.suit === card.suit && c.rank === card.rank);
}

/** Is `card` (from `hand`) a legal play given the top discard card and the
 * currently required suit? */
export function isLegalPlay(
  hand: readonly Card[],
  topCard: Card,
  requiredSuit: Suit,
  card: Card,
): boolean {
  if (!handHas(hand, card)) return false;
  if (card.rank === WILD_RANK) return true;
  if (card.suit === requiredSuit) return true;
  return card.rank === topCard.rank;
}

/** List every legal play in `hand` given the current table state. */
export function legalPlays(hand: readonly Card[], topCard: Card, requiredSuit: Suit): Card[] {
  return hand.filter((c) => isLegalPlay(hand, topCard, requiredSuit, c));
}
