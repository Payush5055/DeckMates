/**
 * Crazy 8s scoring.
 *
 * ── Rule ─────────────────────────────────────────────────────────────────────
 * When a round ends (a player empties their hand), every OTHER player adds the
 * value of the cards remaining in their own hand to their running cumulative
 * total: 8s = 50, face cards (J/Q/K) = 10 each, Ace = 1, number cards 2–10 =
 * face value. The round winner adds 0.
 *
 * The match ends the instant any player's cumulative total reaches or exceeds
 * 100 (100 exactly ends it — locked decision for this build).
 * ────────────────────────────────────────────────────────────────────────────
 */

import { ACE_POINTS, EIGHT_POINTS, FACE_CARD_POINTS, GAME_END_THRESHOLD, WILD_RANK, type Card } from './types';

/** Point value of a single leftover card. */
export function cardValue(card: Card): number {
  if (card.rank === WILD_RANK) return EIGHT_POINTS;
  if (card.rank === 11 || card.rank === 12 || card.rank === 13) return FACE_CARD_POINTS; // J, Q, K
  if (card.rank === 14) return ACE_POINTS; // Ace
  return card.rank; // 2–10 = face value
}

/** Total point value of a hand (sum of its cards' values). */
export function handValue(hand: readonly Card[]): number {
  return hand.reduce((sum, c) => sum + cardValue(c), 0);
}

/**
 * Score a completed round: the winner scores 0; every other seat scores the
 * point value of the cards left in their hand. Returns points indexed by seat.
 */
export function scoreRound(hands: readonly (readonly Card[])[], winnerSeat: number): number[] {
  return hands.map((hand, seat) => (seat === winnerSeat ? 0 : handValue(hand)));
}

/** True once any cumulative total has reached the game-ending threshold. */
export function isGameOver(cumulativeScores: readonly number[]): boolean {
  return cumulativeScores.some((s) => s >= GAME_END_THRESHOLD);
}

export interface SeatRank {
  readonly seat: number;
  readonly total: number;
  /** 1-based placement; tied totals SHARE a rank (1, 1, 3, 4 …). */
  readonly rank: number;
}

/**
 * Rank seats by cumulative total, LOWEST first — Crazy 8s is a single-winner,
 * lowest-total-wins game (unlike Callbreak's highest-first scoring), so this is
 * the inverse of that ranking's sort direction but shares the same "shared
 * rank on ties" convention (two players can both be 1st).
 */
export function rankByLowest(totals: readonly number[]): SeatRank[] {
  const sorted = totals
    .map((total, seat) => ({ seat, total }))
    .sort((a, b) => a.total - b.total);

  const ranked: SeatRank[] = [];
  sorted.forEach((entry, i) => {
    const prev = ranked[i - 1];
    const rank = prev && entry.total === prev.total ? prev.rank : i + 1;
    ranked.push({ seat: entry.seat, total: entry.total, rank });
  });
  return ranked;
}
