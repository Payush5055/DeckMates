import { describe, expect, it } from 'vitest';
import { isLegalPlay, legalPlays, resolveTrick, TrickPlay } from './trick';
import { Card, Seat } from './types';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

describe('isLegalPlay (relaxed follow-suit)', () => {
  const hand: Card[] = [c('H', 10), c('H', 4), c('S', 12), c('C', 7)];

  it('allows any held card when leading (no lead suit yet)', () => {
    expect(isLegalPlay(hand, null, c('S', 12))).toBe(true);
    expect(isLegalPlay(hand, null, c('C', 7))).toBe(true);
  });

  it('rejects a card the player does not hold', () => {
    expect(isLegalPlay(hand, null, c('D', 9))).toBe(false);
  });

  it('forces following the lead suit when the player holds it', () => {
    // Lead is hearts and the hand has hearts → must play a heart.
    expect(isLegalPlay(hand, 'H', c('H', 10))).toBe(true);
    expect(isLegalPlay(hand, 'H', c('S', 12))).toBe(false); // spade not allowed here
    expect(isLegalPlay(hand, 'H', c('C', 7))).toBe(false);
  });

  it('allows any card (including a non-trump) when void of the lead suit', () => {
    // Lead is diamonds; hand has no diamonds → anything goes, no forced trump.
    expect(isLegalPlay(hand, 'D', c('C', 7))).toBe(true); // discard, not forced to spade
    expect(isLegalPlay(hand, 'D', c('S', 12))).toBe(true); // may trump if desired
  });

  it('legalPlays lists exactly the followable cards when holding the lead suit', () => {
    expect(legalPlays(hand, 'H').map((x) => x.rank).sort((a, b) => a - b)).toEqual([4, 10]);
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
