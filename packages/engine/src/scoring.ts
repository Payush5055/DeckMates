/**
 * Callbreak scoring.
 *
 * ── Scoring rules encoded here ──────────────────────────────────────────────
 * All values are kept as INTEGER TENTHS of a point to avoid floating-point
 * drift (0.1 + 0.1 + 0.1 !== 0.3 in IEEE floats). Display = tenths / 10.
 *
 *   • Bid MET (tricksWon >= bid):
 *       score = bid points + 0.1 per overtrick
 *             = bid*10 tenths + (tricksWon - bid) tenths
 *     e.g. bid 3, won 5 → 30 + 2 = 32 tenths → 3.2
 *
 *   • Bid MISSED (tricksWon < bid):
 *       score = -bid points = -(bid*10) tenths
 *     e.g. bid 3, won 2 → -30 tenths → -3.0
 *
 * There is no nil/zero bid in this build (minimum bid is 1).
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Seat } from './types';

/** Round score for one player, in integer tenths of a point. */
export function roundScoreTenths(bid: number, tricksWon: number): number {
  if (tricksWon >= bid) {
    // Base bid value plus one tenth (0.1) for each overtrick.
    return bid * 10 + (tricksWon - bid);
  }
  // Missed the bid: lose the full bid value.
  return -(bid * 10);
}

/** Convert internal tenths to a numeric point value (e.g. 32 → 3.2). */
export function tenthsToPoints(tenths: number): number {
  return tenths / 10;
}

/** Format tenths as a fixed 1-decimal string for display (e.g. 32 → "3.2"). */
export function formatPoints(tenths: number): string {
  return (tenths / 10).toFixed(1);
}

export interface SeatRank {
  readonly seat: Seat;
  readonly totalTenths: number;
  /** 1-based placement. Tied totals SHARE a rank (1, 1, 3, 4 …). */
  readonly rank: number;
}

/**
 * Rank seats by cumulative score, highest first. Ties share the same rank
 * (standard "competition ranking": two firsts are followed by a third).
 *
 * @param totals cumulative tenths per seat, indexed by seat 0..3.
 */
export function rankSeats(totals: readonly number[]): SeatRank[] {
  const sorted = totals
    .map((totalTenths, seat) => ({ seat: seat as Seat, totalTenths }))
    .sort((a, b) => b.totalTenths - a.totalTenths);

  const ranked: SeatRank[] = [];
  sorted.forEach((entry, i) => {
    const prev = ranked[i - 1];
    // Same total as the player above → same rank; otherwise rank = position + 1.
    const rank = prev && entry.totalTenths === prev.totalTenths ? prev.rank : i + 1;
    ranked.push({ seat: entry.seat, totalTenths: entry.totalTenths, rank });
  });
  return ranked;
}
