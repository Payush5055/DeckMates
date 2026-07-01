import { describe, expect, it } from 'vitest';
import { createDeck, deal, createShuffledHands, shuffle, sortHand } from './deck';
import { cardId } from './types';
import { mulberry32 } from './test-utils';

describe('createDeck', () => {
  it('produces exactly 52 cards', () => {
    expect(createDeck()).toHaveLength(52);
  });

  it('produces 52 unique cards (no duplicates)', () => {
    const deck = createDeck();
    const ids = new Set(deck.map(cardId));
    expect(ids.size).toBe(52);
  });

  it('has 13 cards of each suit', () => {
    const deck = createDeck();
    for (const suit of ['S', 'H', 'D', 'C'] as const) {
      expect(deck.filter((c) => c.suit === suit)).toHaveLength(13);
    }
  });
});

describe('shuffle', () => {
  it('does not mutate the input deck', () => {
    const deck = createDeck();
    const before = deck.map(cardId).join(',');
    shuffle(deck, mulberry32(1));
    expect(deck.map(cardId).join(',')).toBe(before);
  });

  it('preserves the exact multiset of cards (a permutation)', () => {
    const deck = createDeck();
    const shuffled = shuffle(deck, mulberry32(42));
    expect(shuffled).toHaveLength(52);
    expect(new Set(shuffled.map(cardId)).size).toBe(52);
  });

  it('is deterministic for a fixed seed', () => {
    const a = shuffle(createDeck(), mulberry32(7)).map(cardId).join(',');
    const b = shuffle(createDeck(), mulberry32(7)).map(cardId).join(',');
    expect(a).toBe(b);
  });

  it('actually reorders the deck', () => {
    const ordered = createDeck().map(cardId).join(',');
    const shuffled = shuffle(createDeck(), mulberry32(123)).map(cardId).join(',');
    expect(shuffled).not.toBe(ordered);
  });
});

describe('deal', () => {
  it('deals 4 hands of 13 cards', () => {
    const hands = deal(createDeck());
    expect(hands).toHaveLength(4);
    hands.forEach((h) => expect(h).toHaveLength(13));
  });

  it('deals all 52 cards with no duplicates across hands', () => {
    const hands = createShuffledHands(mulberry32(99));
    const all = hands.flat().map(cardId);
    expect(all).toHaveLength(52);
    expect(new Set(all).size).toBe(52);
  });

  it('throws on a deck that is not 52 cards', () => {
    expect(() => deal(createDeck().slice(0, 51))).toThrow();
  });
});

describe('sortHand', () => {
  it('groups by suit and sorts by rank descending, without mutating input', () => {
    const hand = [
      { suit: 'H', rank: 2 },
      { suit: 'S', rank: 14 },
      { suit: 'S', rank: 3 },
      { suit: 'C', rank: 10 },
    ] as const;
    const sorted = sortHand([...hand]);
    expect(sorted.map(cardId)).toEqual(['S14', 'S3', 'H2', 'C10']);
  });
});
