/**
 * Trick-taking rules: legal-move validation and trick winner resolution.
 *
 * ── Callbreak rules encoded here ────────────────────────────────────────────
 * Follow-suit enforcement (RELAXED variant, chosen for this build):
 *   • When a lead suit is set and the player HOLDS that suit, they must play a
 *     card of the lead suit.
 *   • Otherwise (leading a new trick, or void of the lead suit) any card is
 *     legal — the player is NOT forced to beat the current best card, and is
 *     NOT forced to trump with a spade when void.
 *
 * Winning a trick (this is independent of the relaxed play rules above):
 *   • Spades are ALWAYS trump. If any spade was played, the highest spade wins.
 *   • If no spade was played, the highest card of the LEAD suit wins.
 *   • Off-suit, non-trump cards can never win a trick.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Card, Seat, Suit, TRUMP_SUIT } from './types';

/** One card played into the current trick, tagged with who played it. */
export interface TrickPlay {
  readonly seat: Seat;
  readonly card: Card;
}

function handHas(hand: readonly Card[], card: Card): boolean {
  return hand.some((c) => c.suit === card.suit && c.rank === card.rank);
}

/**
 * Is `card` a legal play for a player holding `hand`, given the current
 * `leadSuit` (null when this player is leading the trick)?
 *
 * Relaxed follow-suit: must follow the lead suit only if the hand contains it.
 */
export function isLegalPlay(
  hand: readonly Card[],
  leadSuit: Suit | null,
  card: Card,
): boolean {
  // You can only play a card you actually hold.
  if (!handHas(hand, card)) return false;

  // Leading a trick: anything in hand is fair game.
  if (leadSuit === null) return true;

  // Must follow the lead suit if you hold at least one card of it.
  const canFollow = hand.some((c) => c.suit === leadSuit);
  if (canFollow) return card.suit === leadSuit;

  // Void of the lead suit: play anything (no forced trump in the relaxed rules).
  return true;
}

/**
 * List the legal plays from `hand` for the given `leadSuit`. Useful for UI
 * (which cards to enable) and for bots / tests.
 */
export function legalPlays(hand: readonly Card[], leadSuit: Suit | null): Card[] {
  return hand.filter((c) => isLegalPlay(hand, leadSuit, c));
}

/**
 * Resolve who wins a COMPLETED trick. `plays` must be non-empty and in play
 * order (plays[0] is the lead). The lead suit is the suit of the first card.
 *
 * Spades trump everything; otherwise the highest card of the lead suit wins.
 */
export function resolveTrick(plays: readonly TrickPlay[]): Seat {
  if (plays.length === 0) {
    throw new Error('resolveTrick() called with no plays');
  }
  const leadSuit = plays[0]!.card.suit;

  // If any spade was played, only spades can win; otherwise only the lead suit.
  const spades = plays.filter((p) => p.card.suit === TRUMP_SUIT);
  const contenders = spades.length > 0
    ? spades
    : plays.filter((p) => p.card.suit === leadSuit);

  // Highest rank among the contenders wins.
  return contenders.reduce((best, p) => (p.card.rank > best.card.rank ? p : best)).seat;
}
