import { describe, expect, it } from 'vitest';
import { cardPoints, handValue, isThreeOfAKind } from './scoring';
import type { Card } from './types';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

describe('cardPoints', () => {
  it('scores an Ace as 11', () => {
    expect(cardPoints(c('S', 14))).toBe(11);
  });
  it('scores J/Q/K as 10 each', () => {
    expect(cardPoints(c('H', 11))).toBe(10);
    expect(cardPoints(c('H', 12))).toBe(10);
    expect(cardPoints(c('H', 13))).toBe(10);
  });
  it('scores number cards at face value', () => {
    expect(cardPoints(c('D', 2))).toBe(2);
    expect(cardPoints(c('D', 9))).toBe(9);
    expect(cardPoints(c('D', 10))).toBe(10);
  });
});

describe('handValue', () => {
  it('sums all three cards when they share one suit', () => {
    // 9♠ + 7♠ + 4♠ = 20
    expect(handValue([c('S', 9), c('S', 7), c('S', 4)])).toBe(20);
  });

  it('reaches the 31 maximum with A + K + Q of one suit', () => {
    expect(handValue([c('H', 14), c('H', 13), c('H', 12)])).toBe(31);
  });

  it('two share a suit, third is LOWER: value is the pair sum', () => {
    // 9♠ + 6♠ = 15 vs 9♥ alone = 9 → 15
    expect(handValue([c('S', 9), c('S', 6), c('H', 9)])).toBe(15);
  });

  it('two share a suit, third alone is HIGHER: value is the third card (edge case)', () => {
    // 2♠ + 3♠ = 5 vs K♥ alone = 10 → 10
    expect(handValue([c('S', 2), c('S', 3), c('H', 13)])).toBe(10);
  });

  it('all different suits: value is the single highest card', () => {
    // A♦ (11), 9♠ (9), 4♣ (4) → 11
    expect(handValue([c('D', 14), c('S', 9), c('C', 4)])).toBe(11);
  });

  it('three of a kind is a flat 30 regardless of rank', () => {
    expect(handValue([c('S', 5), c('H', 5), c('D', 5)])).toBe(30);
    // Even three ACES — which would only be 11 by suit-sum — score the flat 30.
    expect(handValue([c('S', 14), c('H', 14), c('D', 14)])).toBe(30);
    expect(isThreeOfAKind([c('S', 14), c('H', 14), c('D', 14)])).toBe(true);
  });

  it('three of a kind (30) is NOT an instant-31 hand', () => {
    expect(handValue([c('S', 13), c('H', 13), c('D', 13)])).not.toBe(31);
  });
});
