import { describe, expect, it } from 'vitest';
import { formatPoints, rankSeats, roundScoreTenths, tenthsToPoints } from './scoring';

describe('roundScoreTenths', () => {
  it('bid met exactly scores bid × 10 tenths (no overtricks)', () => {
    // bid 3, won 3 → 3.0 points → 30 tenths
    expect(roundScoreTenths(3, 3)).toBe(30);
  });

  it('overtricks add 0.1 (1 tenth) each', () => {
    // bid 3, won 5 → 3 + 0.2 = 3.2 → 32 tenths
    expect(roundScoreTenths(3, 5)).toBe(32);
    // bid 1, won 13 → 1 + 1.2 = 2.2 → 22 tenths
    expect(roundScoreTenths(1, 13)).toBe(22);
  });

  it('missing the bid loses the full bid value', () => {
    // bid 3, won 2 → -3.0 → -30 tenths
    expect(roundScoreTenths(3, 2)).toBe(-30);
    // bid 8, won 0 → -8.0 → -80 tenths
    expect(roundScoreTenths(8, 0)).toBe(-80);
  });

  it('display helpers convert tenths correctly', () => {
    expect(tenthsToPoints(32)).toBe(3.2);
    expect(formatPoints(32)).toBe('3.2');
    expect(formatPoints(-30)).toBe('-3.0');
  });
});

describe('rankSeats (shared rank on ties)', () => {
  it('ranks distinct totals 1..4 by score descending', () => {
    const ranked = rankSeats([30, 50, 10, 20]);
    // seat 1 (50) first, seat 0 (30) second, seat 3 (20) third, seat 2 (10) fourth
    expect(ranked.map((r) => [r.seat, r.rank])).toEqual([
      [1, 1],
      [0, 2],
      [3, 3],
      [2, 4],
    ]);
  });

  it('gives tied seats the same rank and skips the next (competition ranking)', () => {
    const ranked = rankSeats([50, 50, 30, 20]);
    const rankBySeat = new Map(ranked.map((r) => [r.seat, r.rank]));
    expect(rankBySeat.get(0)).toBe(1);
    expect(rankBySeat.get(1)).toBe(1); // tied for first
    expect(rankBySeat.get(2)).toBe(3); // rank 2 is skipped
    expect(rankBySeat.get(3)).toBe(4);
  });

  it('handles a four-way tie as all rank 1', () => {
    const ranked = rankSeats([25, 25, 25, 25]);
    expect(ranked.every((r) => r.rank === 1)).toBe(true);
  });
});
