import { describe, expect, it } from 'vitest';
import { isLegalPlay, legalPlays } from './rules';
import type { Card } from './types';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

describe('isLegalPlay', () => {
  it('rejects a card the player does not hold', () => {
    const hand = [c('H', 5)];
    expect(isLegalPlay(hand, c('H', 9), 'H', c('D', 9))).toBe(false);
  });

  it('allows a card matching the required suit', () => {
    const hand = [c('H', 5), c('C', 2)];
    expect(isLegalPlay(hand, c('D', 9), 'H', c('H', 5))).toBe(true);
  });

  it('allows a card matching the top card’s rank even if the suit differs', () => {
    const hand = [c('C', 9)];
    // Top card is 9 of diamonds, required suit is diamonds; playing 9 of clubs
    // matches by RANK even though its suit doesn't match.
    expect(isLegalPlay(hand, c('D', 9), 'D', c('C', 9))).toBe(true);
  });

  it('rejects a card matching neither the required suit nor the top card’s rank', () => {
    const hand = [c('C', 4)];
    expect(isLegalPlay(hand, c('D', 9), 'D', c('C', 4))).toBe(false);
  });

  it('an 8 is always playable, regardless of suit or the top card', () => {
    const hand = [c('C', 8)];
    expect(isLegalPlay(hand, c('D', 9), 'H', c('C', 8))).toBe(true);
  });

  it('the required suit can differ from the top card’s own suit (after an 8 declared it)', () => {
    // Top card is literally 8 of hearts, but the declared/required suit is spades.
    const hand = [c('S', 4), c('H', 2)];
    expect(isLegalPlay(hand, c('H', 8), 'S', c('S', 4))).toBe(true);
    // Hearts (the 8's own printed suit) is NOT what's required, and rank 2 != rank 8.
    expect(isLegalPlay(hand, c('H', 8), 'S', c('H', 2))).toBe(false);
  });
});

describe('legalPlays', () => {
  it('lists every legal card: suit matches, rank matches, and any 8s', () => {
    const hand = [c('D', 9), c('C', 8), c('S', 3), c('H', 9), c('C', 4)];
    // Top card D5, required suit D: only D-suited cards, rank-5 cards, or 8s qualify.
    const legal = legalPlays(hand, c('D', 5), 'D');
    expect(legal.map((x) => `${x.suit}${x.rank}`).sort()).toEqual(['C8', 'D9']);
  });
});
