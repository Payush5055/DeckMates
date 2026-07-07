import { describe, expect, it } from 'vitest';
import { cardValue, handValue, isGameOver, rankByLowest, scoreRound } from './scoring';
import type { Card } from './types';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

describe('cardValue', () => {
  it('scores an 8 as 50 (wild)', () => {
    expect(cardValue(c('S', 8))).toBe(50);
  });
  it('scores J/Q/K as 10 each', () => {
    expect(cardValue(c('H', 11))).toBe(10);
    expect(cardValue(c('H', 12))).toBe(10);
    expect(cardValue(c('H', 13))).toBe(10);
  });
  it('scores an Ace as 1', () => {
    expect(cardValue(c('D', 14))).toBe(1);
  });
  it('scores number cards 2–10 at face value', () => {
    expect(cardValue(c('C', 2))).toBe(2);
    expect(cardValue(c('C', 7))).toBe(7);
    expect(cardValue(c('C', 10))).toBe(10);
  });
});

describe('handValue', () => {
  it('sums the value of every card in the hand', () => {
    // 8 (50) + K (10) + A (1) + 7 (7) = 68
    const hand = [c('S', 8), c('H', 13), c('D', 14), c('C', 7)];
    expect(handValue(hand)).toBe(68);
  });
  it('is 0 for an empty hand', () => {
    expect(handValue([])).toBe(0);
  });
});

describe('scoreRound', () => {
  it('scores the winner 0 and every other seat their hand value', () => {
    const hands = [
      [c('H', 13)], // seat 0: K = 10
      [], // seat 1: winner, empty hand
      [c('S', 8), c('C', 2)], // seat 2: 8 + 2 = 52
    ];
    expect(scoreRound(hands, 1)).toEqual([10, 0, 52]);
  });
});

describe('isGameOver', () => {
  it('is false while every total is under 100', () => {
    expect(isGameOver([40, 99, 0, 55])).toBe(false);
  });
  it('is true the instant a total reaches exactly 100 (locked: >= ends it)', () => {
    expect(isGameOver([100, 20, 0])).toBe(true);
  });
  it('is true when a total exceeds 100', () => {
    expect(isGameOver([20, 130])).toBe(true);
  });
});

describe('rankByLowest', () => {
  it('ranks the LOWEST total as 1st — Crazy 8s has a single winner, not one loser', () => {
    const ranked = rankByLowest([80, 20, 100, 45]);
    const bySeat = new Map(ranked.map((r) => [r.seat, r.rank]));
    expect(bySeat.get(1)).toBe(1); // total 20 — best
    expect(bySeat.get(3)).toBe(2); // total 45
    expect(bySeat.get(0)).toBe(3); // total 80
    expect(bySeat.get(2)).toBe(4); // total 100 — worst
  });

  it('gives tied lowest totals the same rank and skips the next (shared rank)', () => {
    const ranked = rankByLowest([30, 30, 90]);
    const bySeat = new Map(ranked.map((r) => [r.seat, r.rank]));
    expect(bySeat.get(0)).toBe(1);
    expect(bySeat.get(1)).toBe(1);
    expect(bySeat.get(2)).toBe(3); // rank 2 skipped
  });
});
