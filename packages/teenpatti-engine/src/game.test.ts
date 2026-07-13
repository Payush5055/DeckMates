import { describe, expect, it } from 'vitest';
import type { Card } from '@cardadda/engine';
import {
  compareHands,
  createGame,
  evaluateHand,
  getBetBounds,
  placeBet,
  requestShow,
  requestSideShow,
  respondToSideShow,
  seeCards,
  type GameState,
} from './index';

function c(suit: Card['suit'], rank: Card['rank']): Card {
  return { suit, rank };
}

function rig(overrides: Partial<GameState>): GameState {
  return {
    phase: 'playing',
    mode: 'classic',
    numPlayers: 3,
    boot: 1,
    pot: 3,
    currentStake: 1,
    jokerRank: null,
    hands: [
      [c('S', 14), c('H', 14), c('D', 14)],
      [c('S', 13), c('S', 12), c('S', 11)],
      [c('C', 2), c('D', 5), c('H', 9)],
    ],
    active: [true, true, true],
    seen: [true, true, true],
    turn: 0,
    pendingSideShow: null,
    lastAction: null,
    eliminationOrder: [],
    winner: null,
    showdown: null,
    ...overrides,
  };
}

describe('Teen Patti evaluation', () => {
  it('ranks trail above pure sequence', () => {
    const trail = evaluateHand([c('S', 14), c('H', 14), c('D', 14)], 'classic', null);
    const pure = evaluateHand([c('S', 13), c('S', 12), c('S', 11)], 'classic', null);
    expect(compareHands([c('S', 14), c('H', 14), c('D', 14)], [c('S', 13), c('S', 12), c('S', 11)], 'classic', null)).toBeGreaterThan(0);
    expect(trail.category).toBe('trail');
    expect(pure.category).toBe('pureSequence');
  });

  it('treats A-2-3 as a valid low sequence', () => {
    const hand = evaluateHand([c('S', 14), c('H', 2), c('D', 3)], 'classic', null);
    expect(hand.category).toBe('sequence');
    const higher = evaluateHand([c('S', 3), c('H', 4), c('D', 5)], 'classic', null);
    expect(compareHands([c('S', 14), c('H', 2), c('D', 3)], [c('S', 3), c('H', 4), c('D', 5)], 'classic', null)).toBeLessThan(0);
    expect(higher.category).toBe('sequence');
  });

  it('lets joker wildcards complete the best hand', () => {
    const hand = evaluateHand([c('S', 9), c('H', 6), c('D', 6)], 'joker', 6);
    expect(hand.category).toBe('trail');
  });

  it('lets AK47 wildcards form premium hands', () => {
    const hand = evaluateHand([c('S', 14), c('H', 14), c('D', 7)], 'ak47', null);
    expect(hand.category).toBe('trail');
  });
});

describe('Teen Patti betting and showdown flow', () => {
  it('updates stake from a blind bet by the full bet amount', () => {
    const game = createGame(4, 'classic');
    const next = placeBet(game, 0, 2);
    expect(next.currentStake).toBe(2);
    expect(next.turn).toBe(1);
  });

  it('updates stake from a seen bet by half the bet amount', () => {
    const seen = seeCards(createGame(4, 'classic'), 0);
    const bounds = getBetBounds(seen, 0);
    expect(bounds).toEqual({ min: 2, max: 4 });
    const next = placeBet(seen, 0, 4);
    expect(next.currentStake).toBe(2);
    expect(next.turn).toBe(1);
  });

  it('makes the requester fold on a tied side show', () => {
    const state = rig({
      active: [true, true, true],
      seen: [true, true, false],
      hands: [
        [c('S', 14), c('H', 10), c('D', 4)],
        [c('C', 14), c('D', 10), c('H', 4)],
        [c('S', 2), c('H', 5), c('D', 9)],
      ],
      turn: 1,
    });
    const requested = requestSideShow(state, 1);
    const resolved = respondToSideShow(requested, 0, true);
    expect(resolved.active[1]).toBe(false);
    expect(resolved.eliminationOrder).toEqual([1]);
  });

  it('awards a tied show to the non-paying player', () => {
    const state = rig({
      numPlayers: 2,
      active: [true, true],
      seen: [true, true],
      hands: [
        [c('S', 14), c('H', 10), c('D', 4)],
        [c('C', 14), c('D', 10), c('H', 4)],
      ],
      turn: 0,
      pot: 2,
    });
    const over = requestShow(state, 0);
    expect(over.winner).toBe(1);
    expect(over.showdown?.tie).toBe(true);
  });
});
