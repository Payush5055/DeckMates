import { describe, expect, it } from 'vitest';
import { cardId } from '@cardadda/engine';
import {
  GameState,
  RuleViolation,
  createGame,
  drawUpToThree,
  playCard,
  startNextRound,
  topCard,
} from './game';
import { handSizeFor, type Card, type Seat } from './types';
import { mulberry32 } from './test-utils';

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

/** Build a fully-controlled GameState for precise legality/draw tests. */
function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    phase: 'playing',
    numPlayers: 4,
    roundNumber: 1,
    hands: [[], [], [], []],
    drawPile: [],
    discardPile: [c('D', 5)],
    requiredSuit: 'D',
    turn: 0 as Seat,
    scores: [0, 0, 0, 0],
    history: [],
    ...overrides,
  };
}

describe('createGame', () => {
  it('deals the correct hand size for 2, 3, and 4 players', () => {
    for (const n of [2, 3, 4]) {
      const g = createGame(n, mulberry32(n * 11));
      expect(g.hands).toHaveLength(n);
      g.hands.forEach((h) => expect(h).toHaveLength(handSizeFor(n)));
      expect(g.phase).toBe('playing');
      expect(g.scores).toEqual(new Array(n).fill(0));
    }
  });

  it('round 1 always starts at seat 0 ("seat 1" in 1-indexed terms)', () => {
    expect(createGame(4, mulberry32(1)).turn).toBe(0);
    expect(createGame(2, mulberry32(2)).turn).toBe(0);
  });

  it('rejects player counts outside 2–4', () => {
    expect(() => createGame(1)).toThrow(RuleViolation);
    expect(() => createGame(5)).toThrow(RuleViolation);
  });

  it('the starting discard card is never an 8', () => {
    for (let seed = 1; seed <= 50; seed++) {
      expect(topCard(createGame(4, mulberry32(seed))).rank).not.toBe(8);
    }
  });
});

describe('playCard', () => {
  it('rejects playing out of turn', () => {
    const g = makeState({ turn: 1 as Seat, hands: [[c('D', 9)], [], [], []] });
    expect(() => playCard(g, 0 as Seat, c('D', 9))).toThrow(RuleViolation);
  });

  it('rejects an illegal card', () => {
    const g = makeState({ hands: [[c('C', 4)], [], [], []] }); // top D5, required D
    expect(() => playCard(g, 0 as Seat, c('C', 4))).toThrow(RuleViolation);
  });

  it('advances turn clockwise and sets requiredSuit to the played card’s own suit', () => {
    const g = makeState({ hands: [[c('D', 9), c('H', 2)], [], [], []] });
    const after = playCard(g, 0 as Seat, c('D', 9));
    expect(after.turn).toBe(1);
    expect(after.requiredSuit).toBe('D');
    expect(topCard(after)).toEqual(c('D', 9));
    expect(after.hands[0]).toEqual([c('H', 2)]);
  });

  it('playing an 8 requires a declared suit, which becomes required (independent of the 8’s own suit)', () => {
    const g = makeState({ hands: [[c('C', 8)], [], [], []] });
    expect(() => playCard(g, 0 as Seat, c('C', 8))).toThrow(RuleViolation); // no suit declared
    const after = playCard(g, 0 as Seat, c('C', 8), 'H');
    expect(after.requiredSuit).toBe('H');
    // The literal top card is still the 8 of clubs, even though hearts is required.
    expect(topCard(after)).toEqual(c('C', 8));
  });

  it('rejects a declared suit that is not a real suit', () => {
    const g = makeState({ hands: [[c('C', 8)], [], [], []] });
    expect(() => playCard(g, 0 as Seat, c('C', 8), 'Z' as never)).toThrow(RuleViolation);
  });

  it('emptying a hand ends the round: winner scores 0, others score their hand value', () => {
    const g = makeState({
      hands: [[c('D', 9)], [c('S', 8), c('H', 13)], [c('C', 2)], []],
      scores: [10, 5, 0, 0],
    });
    const after = playCard(g, 0 as Seat, c('D', 9));
    expect(after.phase).toBe('roundEnd');
    expect(after.history).toHaveLength(1);
    const result = after.history[0]!;
    expect(result.winnerSeat).toBe(0);
    // seat1: 8(50)+K(10)=60, seat2: 2, seat3(already empty): 0, winner: 0
    expect(result.pointsThisRound).toEqual([0, 60, 2, 0]);
    expect(after.scores).toEqual([10, 65, 2, 0]);
  });

  it('the game ends immediately once a cumulative total reaches 100', () => {
    const g = makeState({
      hands: [[c('D', 9)], [c('S', 8), c('S', 13), c('S', 12)], [], []],
      scores: [0, 20, 0, 0], // seat1 will gain 50+10+10=70 -> 90, still under
    });
    const after = playCard(g, 0 as Seat, c('D', 9));
    expect(after.phase).toBe('roundEnd');
    expect(after.scores[1]).toBe(90);

    // A second scenario that DOES cross the threshold.
    const g2 = makeState({
      hands: [[c('D', 9)], [c('S', 8), c('S', 13), c('S', 12)], [], []],
      scores: [0, 30, 0, 0], // 30 + 70 = 100 -> game over
    });
    const after2 = playCard(g2, 0 as Seat, c('D', 9));
    expect(after2.phase).toBe('gameOver');
    expect(after2.scores[1]).toBe(100);
  });
});

describe('drawUpToThree', () => {
  it('rejects drawing when the player already has a legal play', () => {
    const g = makeState({ hands: [[c('D', 9)], [], [], []], drawPile: [c('H', 2)] });
    expect(() => drawUpToThree(g, 0 as Seat)).toThrow(RuleViolation);
  });

  it('stops after the first draw the moment it is playable', () => {
    // Hand has nothing playable; draw pile's top-of-stack (drawn first, from
    // the end via pop) is D-suited, so it should be playable immediately.
    const g = makeState({
      hands: [[c('C', 2)], [], [], []],
      drawPile: [c('H', 4), c('D', 7)], // pop() draws D7 first
    });
    const after = drawUpToThree(g, 0 as Seat);
    expect(after.hands[0]).toHaveLength(2); // C2 + drawn D7
    expect(after.drawPile).toEqual([c('H', 4)]); // only one card drawn
    expect(after.turn).toBe(0); // turn stays — must now play the drawn card
  });

  it('draws all 3 and passes the turn when none are playable, keeping all 3 cards', () => {
    const g = makeState({
      hands: [[c('C', 2)], [], [], []],
      drawPile: [c('H', 6), c('H', 4), c('H', 3)], // none match D-suit/rank5/8
      turn: 0 as Seat,
    });
    const after = drawUpToThree(g, 0 as Seat);
    expect(after.hands[0]).toHaveLength(4); // original + all 3 drawn
    expect(after.drawPile).toEqual([]);
    expect(after.turn).toBe(1); // turn passed to the next seat
  });

  it('reshuffles the discard pile into the draw pile if it runs out mid-draw', () => {
    const g = makeState({
      hands: [[c('C', 2)], [], [], []],
      drawPile: [c('H', 6)], // only 1 card available before needing a reshuffle
      discardPile: [c('C', 11), c('S', 3), c('D', 5)], // top = D5; C11/S3 reshuffle fodder
    });
    const after = drawUpToThree(g, 0 as Seat);
    // 1 real draw + reshuffle kicks in for the 2nd/3rd draws from the 2 buried cards.
    expect(after.hands[0]!.length).toBeGreaterThan(1);
    // The 52-card accounting still holds: nothing invented or lost.
    const total = [...after.hands.flat(), ...after.drawPile, ...after.discardPile];
    const original = [c('C', 2), c('H', 6), c('C', 11), c('S', 3), c('D', 5)];
    expect(total.map(cardId).sort()).toEqual(original.map(cardId).sort());
  });
});

describe('startNextRound', () => {
  it('rotates the starting seat by one each round, wrapping at numPlayers', () => {
    // 3-player game: round1->seat0, round2->seat1, round3->seat2, round4->seat0.
    const endedRound1 = makeState({ phase: 'roundEnd', numPlayers: 3, roundNumber: 1 });
    expect(startNextRound(endedRound1, mulberry32(1)).turn).toBe(1);

    const endedRound2 = makeState({ phase: 'roundEnd', numPlayers: 3, roundNumber: 2 });
    expect(startNextRound(endedRound2, mulberry32(2)).turn).toBe(2);

    const endedRound3 = makeState({ phase: 'roundEnd', numPlayers: 3, roundNumber: 3 });
    expect(startNextRound(endedRound3, mulberry32(3)).turn).toBe(0); // wraps back to seat 0
  });

  it('preserves cumulative scores and history across the deal', () => {
    const g = makeState({ hands: [[c('D', 9)], [c('S', 8)], [], []], scores: [10, 20, 30, 40] });
    const ended = playCard(g, 0 as Seat, c('D', 9));
    const next = startNextRound(ended, mulberry32(3));
    expect(next.scores).toEqual(ended.scores);
    expect(next.history).toEqual(ended.history);
  });

  it('throws if the round has not ended yet', () => {
    const g = makeState({ hands: [[c('D', 9)], [], [], []] });
    expect(() => startNextRound(g)).toThrow(RuleViolation);
  });

  it('deals a fresh full hand for the new round', () => {
    const g = makeState({ hands: [[c('D', 9)], [], [], []], numPlayers: 4 });
    const ended = playCard(g, 0 as Seat, c('D', 9));
    const next = startNextRound(ended, mulberry32(9));
    next.hands.forEach((h) => expect(h).toHaveLength(handSizeFor(4)));
  });
});
