import { describe, expect, it } from 'vitest';
import { cardId } from '@cardadda/engine';
import { dealInitial, reshuffleDiscardIntoDraw } from './deck';
import { handSizeFor, type Card } from './types';
import { mulberry32 } from './test-utils';

describe('handSizeFor', () => {
  it('deals 7 cards for 2 players, 5 for 3 or 4 (standard convention)', () => {
    expect(handSizeFor(2)).toBe(7);
    expect(handSizeFor(3)).toBe(5);
    expect(handSizeFor(4)).toBe(5);
  });
});

describe('dealInitial', () => {
  it('deals the correct hand size to every player, for 2/3/4 players', () => {
    for (const numPlayers of [2, 3, 4]) {
      const { hands } = dealInitial(numPlayers, mulberry32(numPlayers));
      expect(hands).toHaveLength(numPlayers);
      hands.forEach((h) => expect(h).toHaveLength(handSizeFor(numPlayers)));
    }
  });

  it('deals 52 unique cards total across hands + draw pile + starter (no duplicates)', () => {
    const { hands, drawPile, topCard } = dealInitial(4, mulberry32(7));
    const all = [...hands.flat(), ...drawPile, topCard].map(cardId);
    expect(all).toHaveLength(52);
    expect(new Set(all).size).toBe(52);
  });

  it('never starts with an 8 face-up (reshuffled back in per the locked rule)', () => {
    // Try many seeds; the starting card must never be an 8 in any of them.
    for (let seed = 1; seed <= 200; seed++) {
      const { topCard } = dealInitial(4, mulberry32(seed));
      expect(topCard.rank).not.toBe(8);
    }
  });

  it('reshuffle-on-starting-8 preserves the full 52-card set', () => {
    // A rigged RNG that always returns 0 forces predictable, extreme shuffles;
    // regardless, the full deck must still be accounted for with no loss.
    const { hands, drawPile, topCard } = dealInitial(4, () => 0);
    const all = [...hands.flat(), ...drawPile, topCard].map(cardId);
    expect(new Set(all).size).toBe(52);
    expect(topCard.rank).not.toBe(8);
  });
});

describe('reshuffleDiscardIntoDraw', () => {
  const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

  it('moves everything except the top card into a fresh draw pile', () => {
    const discard = [c('H', 2), c('D', 5), c('C', 9), c('S', 11)]; // top = S11
    const { drawPile, discardPile } = reshuffleDiscardIntoDraw(discard, mulberry32(1));
    expect(discardPile).toEqual([c('S', 11)]);
    expect(drawPile.map(cardId).sort()).toEqual([c('H', 2), c('D', 5), c('C', 9)].map(cardId).sort());
  });

  it('is a no-op when only the top card exists (nothing beneath it)', () => {
    const discard = [c('H', 2)];
    const { drawPile, discardPile } = reshuffleDiscardIntoDraw(discard, mulberry32(1));
    expect(drawPile).toEqual([]);
    expect(discardPile).toEqual([c('H', 2)]);
  });
});
