/**
 * 31 hand valuation.
 *
 * ── Rule ─────────────────────────────────────────────────────────────────────
 * Cards of the SAME SUIT add together: Ace = 11, J/Q/K = 10, number cards =
 * face value; the maximum is 31 (e.g. A + K + Q of one suit).
 *
 *   • Three of a kind (same rank, any suits) is a flat 30, regardless of rank.
 *   • Otherwise the hand is worth the best single-suit total it contains:
 *       – all three one suit → their sum;
 *       – two share a suit  → the higher of (that pair's sum) or (the third,
 *         off-suit card's value alone) — the off-suit card counts by itself;
 *       – all different     → the single highest card's value.
 *     All three cases are the same rule: the maximum over suits of the sum of
 *     that suit's cards.
 * ────────────────────────────────────────────────────────────────────────────
 */

import { THREE_OF_A_KIND_VALUE, type Card, type Suit } from './types';

/** Point value of one card: Ace = 11, J/Q/K = 10, numbers = face value. */
export function cardPoints(card: Card): number {
  if (card.rank === 14) return 11; // Ace
  if (card.rank >= 11 && card.rank <= 13) return 10; // J, Q, K
  return card.rank; // 2–10
}

/** True when all three cards share one rank (suits necessarily differ). */
export function isThreeOfAKind(hand: readonly Card[]): boolean {
  return hand.length === 3 && hand.every((c) => c.rank === hand[0]!.rank);
}

/**
 * Value of a (3-card) hand per the rules above. Also accepts fewer cards
 * (useful for evaluating partial combinations in bot heuristics).
 */
export function handValue(hand: readonly Card[]): number {
  if (isThreeOfAKind(hand)) return THREE_OF_A_KIND_VALUE;
  const sums = new Map<Suit, number>();
  for (const c of hand) {
    sums.set(c.suit, (sums.get(c.suit) ?? 0) + cardPoints(c));
  }
  let best = 0;
  for (const total of sums.values()) if (total > best) best = total;
  return best;
}
