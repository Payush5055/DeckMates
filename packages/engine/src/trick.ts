/**
 * Trick-taking rules: legal-move validation and trick winner resolution.
 *
 * ── Callbreak rules encoded here ────────────────────────────────────────────
 * Follow-suit enforcement (FULL STRICT variant — no ducking):
 *   1. Must follow the lead suit if able.
 *   2. When following, must HEAD the trick if able: play a card that beats the
 *      current winning card when you hold one (you may choose which winner).
 *      Once a spade has cut a non-spade lead, a lead-suit card can no longer win,
 *      so you're free to play any lead-suit card.
 *   3. If void of the lead suit, must CUT with a spade if you hold one — and if a
 *      spade has already been played to the trick, must OVERCUT with a higher
 *      spade when you have one.
 *   4. Only if void of BOTH the lead suit and spades may you discard freely.
 *
 * Winning a trick:
 *   • Spades are ALWAYS trump. If any spade was played, the highest spade wins.
 *   • If no spade was played, the highest card of the LEAD suit wins.
 *   • Off-suit, non-trump cards can never win a trick.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Card, Seat, TRUMP_SUIT } from './types';

/** One card played into the current trick, tagged with who played it. */
export interface TrickPlay {
  readonly seat: Seat;
  readonly card: Card;
}

function handHas(hand: readonly Card[], card: Card): boolean {
  return hand.some((c) => c.suit === card.suit && c.rank === card.rank);
}

function maxRank(cards: readonly Card[]): number {
  return cards.reduce((m, c) => (c.rank > m ? c.rank : m), 0);
}

/**
 * Is `card` a legal play for a player holding `hand`, given the cards already
 * played to the current `trick` (empty ⇒ this player is leading)?
 *
 * Full strict rules (see the module header) — follow suit, head/overcut when
 * able, and cut with a spade when void of the lead suit.
 */
export function isLegalPlay(
  hand: readonly Card[],
  trick: readonly TrickPlay[],
  card: Card,
): boolean {
  // You can only play a card you actually hold.
  if (!handHas(hand, card)) return false;

  // Leading a trick: anything in hand is fair game.
  if (trick.length === 0) return true;

  const leadSuit = trick[0]!.card.suit;
  const played = trick.map((p) => p.card);
  const hasLead = hand.some((c) => c.suit === leadSuit);

  if (hasLead) {
    // Must follow suit.
    if (card.suit !== leadSuit) return false;
    // A lead-suit card can only win if nobody has cut with a spade (unless the
    // lead suit IS spades, in which case following-suit cards are the trumps).
    const cut = leadSuit !== TRUMP_SUIT && played.some((c) => c.suit === TRUMP_SUIT);
    const highestLead = maxRank(played.filter((c) => c.suit === leadSuit));
    const canHead = !cut && hand.some((c) => c.suit === leadSuit && c.rank > highestLead);
    // Must head the trick if able; otherwise any lead-suit card is fine.
    return canHead ? card.rank > highestLead : true;
  }

  // Void of the lead suit — must cut with a spade if holding one.
  const hasSpade = hand.some((c) => c.suit === TRUMP_SUIT);
  if (hasSpade) {
    if (card.suit !== TRUMP_SUIT) return false;
    const trickSpades = played.filter((c) => c.suit === TRUMP_SUIT);
    if (trickSpades.length > 0) {
      // A spade already cut — must overcut with a higher spade if able.
      const highestSpade = maxRank(trickSpades);
      const canOvercut = hand.some((c) => c.suit === TRUMP_SUIT && c.rank > highestSpade);
      return canOvercut ? card.rank > highestSpade : true;
    }
    return true; // first to cut — any spade
  }

  // Void of both the lead suit and spades — discard anything.
  return true;
}

/**
 * List the legal plays from `hand` given the current `trick`. Useful for UI
 * (which cards to enable) and for bots / tests.
 */
export function legalPlays(hand: readonly Card[], trick: readonly TrickPlay[]): Card[] {
  return hand.filter((c) => isLegalPlay(hand, trick, c));
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
