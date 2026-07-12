import { describe, expect, it } from 'vitest';
import { cardId } from '@cardadda/engine';
import {
  GameState,
  RuleViolation,
  checkInstant31,
  createGame,
  discard,
  draw,
  knock,
  nextAliveSeat,
  startNextRound,
} from './game';
import type { Card, Seat } from './types';
import { mulberry32 } from './test-utils';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

/** Build a fully-controlled GameState for precise rule tests. */
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'playing',
    roundNumber: 1,
    roundStarter: 0 as Seat,
    lives: [3, 3, 3, 3],
    eliminationRound: [null, null, null, null],
    hands: [
      [c('S', 2), c('H', 5), c('D', 9)], // all-diff → 9
      [c('C', 4), c('H', 7), c('S', 10)], // all-diff → 10
      [c('D', 3), c('C', 8), c('H', 12)], // all-diff → 10
      [c('S', 6), c('D', 14), c('C', 13)], // all-diff → 11 (A♦)
    ],
    drawPile: [c('C', 2), c('D', 4), c('H', 3)],
    discardPile: [c('S', 9)],
    turn: 0 as Seat,
    stage: 'draw',
    knocker: null,
    finalTurnsRemaining: null,
    history: [],
    ...overrides,
  };
}

describe('createGame', () => {
  it('deals 3 cards to each of 4 players, one flipped, rest face-down', () => {
    const g = createGame(mulberry32(1));
    if (g.phase === 'playing') {
      g.hands.forEach((h) => expect(h).toHaveLength(3));
      expect(g.discardPile).toHaveLength(1);
      expect(g.drawPile).toHaveLength(52 - 12 - 1);
      const all = [...g.hands.flat(), ...g.drawPile, ...g.discardPile].map(cardId);
      expect(new Set(all).size).toBe(52);
      expect(g.turn).toBe(0);
      expect(g.stage).toBe('draw');
    }
    expect(g.lives).toEqual([3, 3, 3, 3]);
  });
});

describe('draw / discard turn mechanics', () => {
  it('enforces turn order and the draw-then-discard staging', () => {
    const g = makeState();
    expect(() => draw(g, 1 as Seat, 'pile')).toThrow(RuleViolation); // not their turn
    expect(() => discard(g, 0 as Seat, c('S', 2))).toThrow(RuleViolation); // must draw first
    const drawn = draw(g, 0 as Seat, 'pile');
    expect(drawn.hands[0]).toHaveLength(4);
    expect(drawn.stage).toBe('discard');
    expect(() => draw(drawn, 0 as Seat, 'pile')).toThrow(RuleViolation); // already drew
  });

  it('drawing from the discard pile takes its top card', () => {
    const g = makeState();
    const after = draw(g, 0 as Seat, 'discard');
    expect(after.hands[0]!.map(cardId)).toContain('S9');
    expect(after.discardPile).toHaveLength(0);
  });

  it('allows discarding the very card just taken from the discard pile (locked rule)', () => {
    const g = makeState();
    const after = discard(draw(g, 0 as Seat, 'discard'), 0 as Seat, c('S', 9));
    expect(after.discardPile.map(cardId)).toEqual(['S9']); // right back on top
    expect(after.hands[0]).toHaveLength(3);
    expect(after.turn).toBe(1); // turn passed
  });

  it('rejects discarding a card not held', () => {
    const g = draw(makeState(), 0 as Seat, 'pile');
    expect(() => discard(g, 0 as Seat, c('H', 14))).toThrow(RuleViolation);
  });

  it('replenishes an empty draw pile by shuffling the discards beneath the top card', () => {
    const g = makeState({
      drawPile: [],
      discardPile: [c('C', 5), c('D', 7), c('S', 9)], // S9 stays on top
    });
    const after = draw(g, 0 as Seat, 'pile', mulberry32(3));
    expect(after.hands[0]).toHaveLength(4);
    expect(after.discardPile.map(cardId)).toEqual(['S9']);
    expect(after.drawPile.length).toBe(1); // C5/D7 reshuffled, one drawn
  });

  it('advances clockwise, skipping eliminated seats', () => {
    const g = makeState({ lives: [3, 0, 3, 3] });
    const after = discard(draw(g, 0 as Seat, 'pile'), 0 as Seat, c('S', 2));
    expect(after.turn).toBe(2); // seat 1 is out
    expect(nextAliveSeat([3, 0, 0, 3], 3 as Seat)).toBe(0);
  });
});

describe('instant 31', () => {
  it('detects a dealt 31: round ends immediately, everyone else loses a life', () => {
    const g = makeState({
      hands: [
        [c('H', 14), c('H', 13), c('H', 12)], // 31 on the deal
        [c('C', 4), c('H', 7), c('S', 10)],
        [c('D', 3), c('C', 8), c('H', 2)],
        [c('S', 6), c('D', 10), c('C', 13)],
      ],
    });
    const after = checkInstant31(g);
    expect(after.phase).toBe('roundEnd');
    const r = after.history[0]!;
    expect(r.reason).toBe('instant31');
    expect(r.winners31).toEqual([0]);
    expect(r.livesLost).toEqual([0, 1, 1, 1]);
    expect(after.lives).toEqual([3, 2, 2, 2]);
  });

  it('multiple simultaneous dealt 31s: all holders safe, everyone else loses 1', () => {
    const g = makeState({
      hands: [
        [c('H', 14), c('H', 13), c('H', 12)],
        [c('S', 14), c('S', 13), c('S', 12)],
        [c('D', 3), c('C', 8), c('H', 2)],
        [c('S', 6), c('D', 10), c('C', 13)],
      ],
    });
    const after = checkInstant31(g);
    expect(after.history[0]!.winners31).toEqual([0, 1]);
    expect(after.lives).toEqual([3, 3, 2, 2]);
  });

  it('a discard that lands on exactly 31 ends the round mid-turn — even during a knock’s final turns', () => {
    const g = makeState({
      hands: [
        [c('H', 14), c('H', 13), c('D', 2)],
        [c('C', 4), c('H', 7), c('S', 10)],
        [c('D', 3), c('C', 8), c('H', 2)],
        [c('S', 6), c('D', 10), c('C', 13)],
      ],
      knocker: 3 as Seat,
      finalTurnsRemaining: 3,
      discardPile: [c('H', 12)], // Q♥ on top completes A+K+Q of hearts
    });
    const after = discard(draw(g, 0 as Seat, 'discard'), 0 as Seat, c('D', 2));
    expect(after.phase).toBe('roundEnd');
    const r = after.history[0]!;
    expect(r.reason).toBe('instant31'); // trumps the pending knock reveal
    expect(r.winners31).toEqual([0]);
    expect(after.lives).toEqual([3, 2, 2, 2]); // knocker loses a life too
  });
});

describe('knock and reveal', () => {
  /** Every non-knocker draws from the pile and discards the drawn card. */
  function playOutFinalTurns(g: GameState): GameState {
    let s = g;
    while (s.phase === 'playing') {
      const seat = s.turn;
      s = draw(s, seat, 'pile', mulberry32(99));
      s = discard(s, seat, s.hands[seat]![3]!); // discard the drawn card
    }
    return s;
  }

  it('knocking uses the whole turn and gives every other player exactly one final turn', () => {
    let g = makeState();
    g = knock(g, 0 as Seat);
    expect(g.knocker).toBe(0);
    expect(g.finalTurnsRemaining).toBe(3);
    expect(g.turn).toBe(1);
    expect(g.stage).toBe('draw');
    expect(() => knock(g, 1 as Seat)).toThrow(RuleViolation); // no second knock

    const done = playOutFinalTurns(g);
    expect(done.phase).toBe('roundEnd');
    expect(done.history[0]!.reason).toBe('knock');
  });

  it('cannot knock after drawing', () => {
    const g = draw(makeState(), 0 as Seat, 'pile');
    expect(() => knock(g, 0 as Seat)).toThrow(RuleViolation);
  });

  // Hand values in makeState: seat0=9, seat1=10, seat2=10, seat3=11.
  it('lowest hand loses one life on a normal knock reveal', () => {
    // Knocker seat 3 (value 11); seat 0 is strictly lowest (9).
    let g = makeState({ turn: 3 as Seat });
    g = knock(g, 3 as Seat);
    const done = playOutFinalTurns(
      // Freeze hands: each player discards what they draw, so values are stable.
      g,
    );
    const r = done.history[0]!;
    expect(r.knockerSeat).toBe(3);
    expect(r.livesLost).toEqual([1, 0, 0, 0]);
    expect(r.doublePenalty).toBe(false);
    expect(done.lives).toEqual([2, 3, 3, 3]);
  });

  it('the knocker being strictly lowest loses 2 lives (double penalty)', () => {
    let g = makeState(); // knocker seat 0 has the lowest hand (9)
    g = knock(g, 0 as Seat);
    const done = playOutFinalTurns(g);
    const r = done.history[0]!;
    expect(r.doublePenalty).toBe(true);
    expect(r.livesLost).toEqual([2, 0, 0, 0]);
    expect(done.lives).toEqual([1, 3, 3, 3]);
  });

  it('knocker tying for lowest: only the tied non-knocker loses a life', () => {
    // Seats 1 and 2 both worth 10; make the knocker seat 1 and raise seat 0.
    let g = makeState({
      hands: [
        [c('S', 13), c('S', 5), c('D', 9)], // 15
        [c('C', 4), c('H', 7), c('S', 10)], // 10 — knocker
        [c('D', 3), c('C', 8), c('H', 12)], // 10 — tied non-knocker
        [c('S', 6), c('D', 14), c('C', 13)], // 11 (A♦)
      ],
      turn: 1 as Seat,
    });
    g = knock(g, 1 as Seat);
    const done = playOutFinalTurns(g);
    const r = done.history[0]!;
    expect(r.livesLost).toEqual([0, 0, 1, 0]); // knocker safe, tied rival pays
    expect(r.doublePenalty).toBe(false);
  });

  it('two non-knockers tying for lowest both lose a life', () => {
    let g = makeState({
      hands: [
        [c('S', 13), c('S', 5), c('D', 9)], // 15 — knocker
        [c('C', 4), c('H', 7), c('S', 10)], // 10
        [c('D', 3), c('C', 8), c('H', 12)], // 10
        [c('S', 6), c('D', 14), c('C', 13)], // 11 (A♦)
      ],
    });
    g = knock(g, 0 as Seat);
    const done = playOutFinalTurns(g);
    expect(done.history[0]!.livesLost).toEqual([0, 1, 1, 0]);
  });

  it('a double penalty at 1 life clamps to 0 and eliminates the knocker', () => {
    let g = makeState({ lives: [1, 3, 3, 3] }); // seat 0: lowest hand AND 1 life
    g = knock(g, 0 as Seat);
    const done = playOutFinalTurns(g);
    expect(done.lives[0]).toBe(0);
    expect(done.eliminationRound[0]).toBe(1);
    expect(done.phase).toBe('roundEnd'); // 3 players remain
  });

  it('reducing the table to one living player ends the game', () => {
    // Two players left; the non-knocker (seat 1) is strictly lowest at 1 life.
    let g = makeState({
      lives: [2, 1, 0, 0],
      hands: [
        [c('S', 13), c('S', 5), c('D', 9)], // 15 — knocker
        [c('C', 4), c('H', 7), c('S', 2)], // 7 — lowest, last life
        [],
        [],
      ],
      turn: 0 as Seat,
    });
    g = knock(g, 0 as Seat);
    const done = playOutFinalTurns(g);
    expect(done.phase).toBe('gameOver');
    expect(done.lives).toEqual([2, 0, 0, 0]);
  });

  it('near-void case: all alive tie including the knocker at 1 life — knocker survives (why a full wipe-out is unreachable)', () => {
    let g = makeState({
      lives: [1, 1, 0, 0],
      hands: [
        [c('C', 4), c('H', 7), c('S', 10)], // 10 — knocker
        [c('D', 3), c('C', 8), c('H', 12)], // 10 — tied
        [],
        [],
      ],
    });
    g = knock(g, 0 as Seat);
    const done = playOutFinalTurns(g);
    expect(done.history[0]!.voided).toBe(false);
    expect(done.lives).toEqual([1, 0, 0, 0]); // knocker safe on tie → someone always survives
    expect(done.phase).toBe('gameOver');
  });
});

describe('round rotation', () => {
  it('the starting seat advances clockwise each round, skipping eliminated players', () => {
    const ended = makeState({
      phase: 'roundEnd',
      roundNumber: 1,
      roundStarter: 0 as Seat,
      lives: [3, 0, 2, 2], // seat 1 eliminated
    });
    const next = startNextRound(ended, mulberry32(5));
    if (next.phase === 'playing') {
      expect(next.roundNumber).toBe(2);
      expect(next.roundStarter).toBe(2); // seat 1 skipped
      expect(next.turn).toBe(2);
      expect(next.hands[1]).toEqual([]); // no cards for the eliminated seat
      next.hands.forEach((h, s) => {
        if (s !== 1) expect(h).toHaveLength(3);
      });
    } else {
      // A freak dealt-31 is possible with an arbitrary seed; rotation still held.
      expect(next.roundStarter).toBe(2);
    }
  });

  it('cannot start the next round before the current one ends', () => {
    expect(() => startNextRound(makeState(), mulberry32(6))).toThrow(RuleViolation);
  });
});
