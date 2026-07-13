import { describe, expect, it } from 'vitest';
import type { Card } from '@cardadda/engine';
import {
  createGame,
  fold,
  placeBet,
  requestShow,
  requestSideShow,
  respondToSideShow,
  seeCards,
  type GameState,
} from '@cardadda/teenpatti-engine';
import { chooseAction, chooseSideShowResponse } from './teenPattiBotAI';

function c(suit: Card['suit'], rank: Card['rank']): Card {
  return { suit, rank };
}

function rig(overrides: Partial<GameState>): GameState {
  return {
    phase: 'playing',
    mode: 'classic',
    numPlayers: 4,
    boot: 200,
    pot: 800,
    currentStake: 200,
    jokerRank: null,
    hands: [
      [c('S', 2), c('H', 7), c('D', 9)],
      [c('C', 2), c('D', 7), c('H', 9)],
      [c('S', 3), c('H', 8), c('D', 10)],
      [c('C', 3), c('D', 8), c('H', 10)],
    ],
    active: [true, true, true, true],
    seen: [false, false, false, false],
    turn: 0,
    pendingSideShow: null,
    lastAction: null,
    eliminationOrder: [],
    winner: null,
    showdown: null,
    ...overrides,
  };
}

/** Returns queued values in order, then repeats the last one forever. */
function sequenceRng(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
}

const WEAK_HIGH_CARD: Card[] = [c('S', 2), c('H', 7), c('D', 9)]; // no pair/sequence/color
const TRAIL: Card[] = [c('S', 11), c('H', 11), c('D', 11)];

describe('teenPattiBotAI — chooseAction', () => {
  it('a blind bot looks at its cards when the look-roll succeeds', () => {
    const state = rig({ turn: 0, seen: [false, false, false, false] });
    const action = chooseAction(state, 0, sequenceRng([0])); // 0 < LOOK_PROBABILITY
    expect(action).toEqual({ action: 'see' });
  });

  it('a blind bot with a weak hand just bets the blind minimum when the look-roll fails and the stake has not escalated', () => {
    const state = rig({ turn: 0, seen: [false, false, false, false], hands: [WEAK_HIGH_CARD, [], [], []] as unknown as Card[][] });
    // look: fail, bluff: fail, (no fold check fires — stake === boot, not > 4x)
    const action = chooseAction(state, 0, sequenceRng([0.99, 0.99]));
    expect(action).toEqual({ action: 'bet', amount: state.currentStake }); // blind min == currentStake
  });

  it('a blind bot with a genuinely weak hand folds once the stake has escalated well past the boot', () => {
    const state = rig({
      turn: 0,
      seen: [false, false, false, false],
      currentStake: 1000, // > boot(200) * 4
      hands: [WEAK_HIGH_CARD, [c('S', 12), c('H', 4), c('D', 6)], [c('C', 13), c('D', 5), c('H', 6)], [c('C', 3), c('D', 8), c('H', 10)]],
    });
    // look: fail, bluff: fail, fold-roll: succeed
    const action = chooseAction(state, 0, sequenceRng([0.99, 0.99, 0.1]));
    expect(action).toEqual({ action: 'fold' });
  });

  it('a seen bot with a genuinely weak hand folds facing a bet', () => {
    const state = rig({
      turn: 0,
      seen: [true, true, true, true],
      hands: [WEAK_HIGH_CARD, [c('S', 12), c('H', 4), c('D', 6)], [c('C', 13), c('D', 5), c('H', 6)], [c('C', 3), c('D', 8), c('H', 10)]],
    });
    // bluff: fail, fold-roll: succeed
    const action = chooseAction(state, 0, sequenceRng([0.99, 0.1]));
    expect(action).toEqual({ action: 'fold' });
  });

  it('a seen bot with a weak hand can still get an unlucky non-fold roll and just checks in at the minimum', () => {
    const state = rig({
      turn: 0,
      seen: [true, true, true, true],
      hands: [WEAK_HIGH_CARD, [c('S', 12), c('H', 4), c('D', 6)], [c('C', 13), c('D', 5), c('H', 6)], [c('C', 3), c('D', 8), c('H', 10)]],
    });
    const action = chooseAction(state, 0, sequenceRng([0.99, 0.99]));
    expect(action).toEqual({ action: 'bet', amount: state.currentStake * 2 }); // seen min
  });

  it('a strong hand (trail) pushes toward the maximum legal raise', () => {
    const state = rig({
      turn: 0,
      seen: [true, false, false, false], // others blind so side-show can never trigger
      hands: [TRAIL, [c('S', 12), c('H', 4), c('D', 6)], [c('C', 13), c('D', 5), c('H', 6)], [c('C', 3), c('D', 8), c('H', 10)]],
    });
    const action = chooseAction(state, 0, sequenceRng([0.99])); // bluff roll is irrelevant here
    expect(action).toEqual({ action: 'bet', amount: state.currentStake * 4 }); // seen max
  });

  it('a medium hand (color) bets moderately — more than the minimum, less than the maximum', () => {
    const state = rig({
      turn: 0,
      seen: [true, false, false, false],
      hands: [
        [c('S', 12), c('S', 8), c('S', 4)], // color
        [c('S', 12), c('H', 4), c('D', 6)],
        [c('C', 13), c('D', 5), c('H', 6)],
        [c('C', 3), c('D', 8), c('H', 10)],
      ],
    });
    const action = chooseAction(state, 0, sequenceRng([0.99]));
    expect(action.action).toBe('bet');
    if (action.action === 'bet') {
      expect(action.amount).toBeGreaterThan(state.currentStake * 2);
      expect(action.amount).toBeLessThanOrEqual(state.currentStake * 4);
    }
  });

  it('bluffs occasionally: a weak hand bets aggressively when the bluff-roll succeeds instead of checking in at the minimum', () => {
    const state = rig({
      turn: 0,
      seen: [true, false, false, false],
      hands: [WEAK_HIGH_CARD, [c('S', 12), c('H', 4), c('D', 6)], [c('C', 13), c('D', 5), c('H', 6)], [c('C', 3), c('D', 8), c('H', 10)]],
    });
    // bluff-roll succeeds (< BLUFF_PROBABILITY)
    const action = chooseAction(state, 0, sequenceRng([0.01]));
    expect(action.action).toBe('bet');
    if (action.action === 'bet') {
      expect(action.amount).toBeGreaterThan(state.currentStake * 2); // more than the plain seen minimum
    }
  });

  it('requests a show with real confidence when exactly two players remain and both are seen', () => {
    const state = rig({
      numPlayers: 2,
      turn: 0,
      active: [true, true],
      seen: [true, true],
      hands: [[c('S', 12), c('S', 8), c('S', 4)], [c('H', 3), c('D', 5), c('C', 9)]], // color vs weak
    });
    const action = chooseAction(state, 0, sequenceRng([0.99]));
    expect(action).toEqual({ action: 'show' });
  });

  it('does not request a show with a weak hand even when eligible', () => {
    const state = rig({
      numPlayers: 2,
      turn: 0,
      active: [true, true],
      seen: [true, true],
      hands: [WEAK_HIGH_CARD, [c('S', 12), c('S', 8), c('S', 4)]],
    });
    const action = chooseAction(state, 0, sequenceRng([0.99, 0.99]));
    expect(action.action).not.toBe('show');
  });

  it('requests a side show with a decent hand against a previously seen bettor', () => {
    const state = rig({
      numPlayers: 3,
      turn: 2,
      active: [true, true, true],
      seen: [false, true, true], // seat 1 is the nearest preceding seen seat from seat 2
      hands: [
        [c('S', 2), c('H', 4), c('D', 6)],
        [c('C', 3), c('D', 5), c('H', 9)],
        [c('S', 10), c('H', 9), c('D', 8)], // sequence for seat 2
      ],
    });
    const action = chooseAction(state, 2, sequenceRng([0.99]));
    expect(action).toEqual({ action: 'sideShow' });
  });
});

describe('teenPattiBotAI — chooseSideShowResponse', () => {
  it('accepts with real confidence', () => {
    const state = rig({ hands: [[c('S', 12), c('S', 8), c('S', 4)], [], [], []] as unknown as Card[][] });
    expect(chooseSideShowResponse(state, 0, sequenceRng([0.99]))).toBe(true);
  });

  it('usually refuses a weak hand, but occasionally accepts anyway', () => {
    const state = rig({ hands: [WEAK_HIGH_CARD, [], [], []] as unknown as Card[][] });
    expect(chooseSideShowResponse(state, 0, sequenceRng([0.99]))).toBe(false);
    expect(chooseSideShowResponse(state, 0, sequenceRng([0.01]))).toBe(true);
  });
});

describe('teenPattiBotAI — every hand converges (no livelock)', () => {
  /**
   * Regression test for a real bug found while building this: a table where
   * every bot holds a middling hand (too good to fold cheaply, not good
   * enough to raise) could call the same minimum bet forever, since nothing
   * ever moved `currentStake` and nothing ever forced a fold. Simulates a
   * full 4-bot hand, from deal to gameOver, driven only by the bot AI (using
   * real randomness — no seeding — specifically to catch rare unlucky
   * combinations across many trials) and asserts it always finishes well
   * within a generous turn budget.
   */
  it('a full all-bot hand always reaches gameOver in a bounded number of turns, across many random deals', () => {
    const TRIALS = 300;
    const MAX_TURNS = 500;
    for (let trial = 0; trial < TRIALS; trial++) {
      let g = createGame(4, 'classic', Math.random, 200);
      let turns = 0;
      while (g.phase !== 'gameOver' && turns < MAX_TURNS) {
        turns++;
        if (g.phase === 'sideShow' && g.pendingSideShow) {
          const target = g.pendingSideShow.target;
          g = respondToSideShow(g, target, chooseSideShowResponse(g, target));
          continue;
        }
        const seat = g.turn!;
        const action = chooseAction(g, seat);
        switch (action.action) {
          case 'see':
            g = seeCards(g, seat);
            break;
          case 'fold':
            g = fold(g, seat);
            break;
          case 'show':
            g = requestShow(g, seat);
            break;
          case 'sideShow':
            g = requestSideShow(g, seat);
            break;
          case 'bet':
            g = placeBet(g, seat, action.amount);
            break;
        }
      }
      expect(g.phase, `trial ${trial} never reached gameOver within ${MAX_TURNS} turns`).toBe('gameOver');
    }
  });
});
