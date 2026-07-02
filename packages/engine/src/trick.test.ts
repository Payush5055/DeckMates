import { describe, expect, it } from 'vitest';
import { isLegalPlay, legalPlays, resolveTrick, TrickPlay } from './trick';
import { Card, Seat } from './types';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

/** Build a trick (board) from cards; seats are arbitrary for legality checks. */
const board = (...cards: Card[]): TrickPlay[] => cards.map((card, i) => ({ seat: (i % 4) as Seat, card }));

describe('isLegalPlay (full strict — no ducking)', () => {
  it('allows any held card when leading (empty trick)', () => {
    const hand = [c('H', 10), c('S', 12), c('C', 7)];
    expect(isLegalPlay(hand, [], c('S', 12))).toBe(true);
    expect(isLegalPlay(hand, [], c('C', 7))).toBe(true);
  });

  it('rejects a card the player does not hold', () => {
    expect(isLegalPlay([c('H', 10)], [], c('D', 9))).toBe(false);
  });

  it('forces following the lead suit when the player holds it', () => {
    const hand = [c('H', 10), c('H', 4), c('S', 12), c('C', 7)];
    const trick = board(c('H', 5));
    expect(isLegalPlay(hand, trick, c('S', 12))).toBe(false); // can't cut, holds hearts
    expect(isLegalPlay(hand, trick, c('C', 7))).toBe(false);
  });

  it('must HEAD the trick when it can (no ducking)', () => {
    // Lead H, King on board. Hand can beat it with the Ace → must.
    const hand = [c('H', 14), c('H', 10), c('H', 4)];
    const trick = board(c('H', 13));
    expect(isLegalPlay(hand, trick, c('H', 14))).toBe(true); // beats
    expect(isLegalPlay(hand, trick, c('H', 10))).toBe(false); // ducking not allowed
    expect(isLegalPlay(hand, trick, c('H', 4))).toBe(false);
    expect(legalPlays(hand, trick).map((x) => x.rank)).toEqual([14]);
  });

  it('may play any lead-suit card when it cannot beat the board', () => {
    const hand = [c('H', 10), c('H', 4)];
    const trick = board(c('H', 14)); // Ace already down — can't beat
    expect(isLegalPlay(hand, trick, c('H', 10))).toBe(true);
    expect(isLegalPlay(hand, trick, c('H', 4))).toBe(true);
  });

  it('once a spade has cut, following-suit cards need not beat', () => {
    // Lead H, then a spade cut. Holder of hearts must follow but can play low.
    const hand = [c('H', 13), c('H', 2)];
    const trick = board(c('H', 9), c('S', 3)); // spade cut the hearts
    expect(isLegalPlay(hand, trick, c('H', 2))).toBe(true);
    expect(isLegalPlay(hand, trick, c('H', 13))).toBe(true);
  });

  it('must CUT with a spade when void of the lead suit', () => {
    const hand = [c('H', 9), c('S', 5)];
    const trick = board(c('D', 10));
    expect(isLegalPlay(hand, trick, c('H', 9))).toBe(false); // must cut, holds a spade
    expect(isLegalPlay(hand, trick, c('S', 5))).toBe(true);
  });

  it('must OVERCUT a higher spade when one has already cut', () => {
    const hand = [c('S', 9), c('S', 3)];
    const trick = board(c('D', 10), c('S', 5)); // a 5♠ already cut
    expect(isLegalPlay(hand, trick, c('S', 9))).toBe(true); // 9 > 5
    expect(isLegalPlay(hand, trick, c('S', 3))).toBe(false); // 3 can't overcut
  });

  it('may play any spade when it cannot overcut', () => {
    const hand = [c('S', 5), c('S', 3)];
    const trick = board(c('D', 10), c('S', 10)); // 10♠ down — can't beat
    expect(isLegalPlay(hand, trick, c('S', 5))).toBe(true);
    expect(isLegalPlay(hand, trick, c('S', 3))).toBe(true);
  });

  it('may discard anything when void of both the lead suit and spades', () => {
    const hand = [c('H', 9), c('C', 7)];
    const trick = board(c('D', 10));
    expect(isLegalPlay(hand, trick, c('H', 9))).toBe(true);
    expect(isLegalPlay(hand, trick, c('C', 7))).toBe(true);
  });
});

describe('resolveTrick (spades trump)', () => {
  const play = (seat: Seat, card: Card): TrickPlay => ({ seat, card });

  it('highest card of the lead suit wins when no spade is played', () => {
    const trick = [
      play(0, c('H', 9)),
      play(1, c('H', 13)), // King of hearts — highest heart
      play(2, c('H', 4)),
      play(3, c('C', 14)), // off-suit ace, cannot win
    ];
    expect(resolveTrick(trick)).toBe(1);
  });

  it('a single spade beats a high card of the lead suit', () => {
    const trick = [
      play(0, c('H', 14)), // ace of hearts
      play(1, c('H', 2)),
      play(2, c('S', 2)), // lowest spade still trumps the ace
      play(3, c('H', 13)),
    ];
    expect(resolveTrick(trick)).toBe(2);
  });

  it('highest spade wins when multiple spades are played', () => {
    const trick = [
      play(0, c('H', 10)),
      play(1, c('S', 5)),
      play(2, c('S', 11)), // jack of spades — highest spade
      play(3, c('S', 9)),
    ];
    expect(resolveTrick(trick)).toBe(2);
  });

  it('when spades are led, the highest spade still wins', () => {
    const trick = [
      play(0, c('S', 7)),
      play(1, c('S', 14)), // ace of spades
      play(2, c('S', 3)),
      play(3, c('S', 12)),
    ];
    expect(resolveTrick(trick)).toBe(1);
  });

  it('off-suit non-trump cards can never win', () => {
    const trick = [
      play(0, c('D', 5)),
      play(1, c('C', 14)), // ace of clubs, off-suit
      play(2, c('H', 14)), // ace of hearts, off-suit
      play(3, c('D', 6)), // highest diamond (lead suit) wins
    ];
    expect(resolveTrick(trick)).toBe(3);
  });
});
