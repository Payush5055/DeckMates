import { describe, expect, it } from 'vitest';
import {
  GameState,
  RuleViolation,
  createGame,
  placeBid,
  playCard,
  resolveCompletedTrick,
  startNextRound,
} from './game';
import { legalPlays } from './trick';
import { cardId } from './types';
import { autoPlayGame, autoPlayRound, bidAllMinimum, mulberry32 } from './test-utils';

describe('createGame', () => {
  it('starts round 1 in the bidding phase', () => {
    const g = createGame(mulberry32(1));
    expect(g.phase).toBe('bidding');
    expect(g.roundNumber).toBe(1);
    expect(g.scores).toEqual([0, 0, 0, 0]);
    expect(g.history).toEqual([]);
  });

  it('deals 13 cards to each seat with a full 52-card table', () => {
    const g = createGame(mulberry32(2));
    g.hands.forEach((h) => expect(h).toHaveLength(13));
    const all = g.hands.flat().map(cardId);
    expect(new Set(all).size).toBe(52);
  });

  it('first to act is the seat to the dealer’s left', () => {
    const g = createGame(mulberry32(3), 0); // dealer 0 → first actor 1
    expect(g.turn).toBe(1);
    const g2 = createGame(mulberry32(3), 2); // dealer 2 → first actor 3
    expect(g2.turn).toBe(3);
  });
});

describe('placeBid (simultaneous & blind)', () => {
  it('accepts bids in any order and flips to playing after the 4th bid', () => {
    let g = createGame(mulberry32(4), 0);
    // No turn order — bid in an arbitrary sequence.
    g = placeBid(g, 3, 1);
    g = placeBid(g, 0, 4);
    g = placeBid(g, 2, 3);
    expect(g.phase).toBe('bidding');
    g = placeBid(g, 1, 2); // 4th bid completes bidding
    expect(g.phase).toBe('playing');
    expect(g.bids).toEqual([4, 2, 3, 1]);
    expect(g.turn).toBe(1); // first leader is left of dealer
  });

  it('rejects a second bid from the same seat', () => {
    let g = createGame(mulberry32(5), 0);
    g = placeBid(g, 2, 3);
    expect(() => placeBid(g, 2, 4)).toThrow(RuleViolation);
  });

  it('rejects bids outside 1..8 and non-integers', () => {
    const g = createGame(mulberry32(6), 0);
    expect(() => placeBid(g, 1, 0)).toThrow(RuleViolation); // no nil
    expect(() => placeBid(g, 1, 9)).toThrow(RuleViolation);
    expect(() => placeBid(g, 1, 2.5)).toThrow(RuleViolation);
  });
});

describe('playCard', () => {
  function toPlaying(seed: number): GameState {
    return bidAllMinimum(createGame(mulberry32(seed), 0));
  }

  it('rejects playing out of turn', () => {
    const g = toPlaying(10);
    const notMyTurn = ((g.turn + 1) % 4) as 0 | 1 | 2 | 3;
    const card = g.hands[notMyTurn]![0]!;
    expect(() => playCard(g, notMyTurn, card)).toThrow(RuleViolation);
  });

  it('enforces follow-suit: rejects an off-suit card when the lead suit is held', () => {
    let g = toPlaying(11);
    const leader = g.turn;
    const lead = g.hands[leader]![0]!;
    g = playCard(g, leader, lead);

    const responder = g.turn;
    const hand = g.hands[responder]!;
    const hasLeadSuit = hand.some((c) => c.suit === lead.suit);
    if (hasLeadSuit) {
      const offSuit = hand.find((c) => c.suit !== lead.suit);
      if (offSuit) {
        expect(() => playCard(g, responder, offSuit)).toThrow(RuleViolation);
      }
    }
    // And a legal card always works.
    const legal = legalPlays(hand, g.currentTrick)[0]!;
    expect(() => playCard(g, responder, legal)).not.toThrow();
  });

  it('removes the played card from the hand', () => {
    const g = toPlaying(12);
    const leader = g.turn;
    const card = g.hands[leader]![0]!;
    const after = playCard(g, leader, card);
    expect(after.hands[leader]).toHaveLength(12);
    expect(after.hands[leader]!.some((c) => cardId(c) === cardId(card))).toBe(false);
    expect(after.currentTrick).toHaveLength(1);
  });
});

describe('completed-trick hold (the 4th-card fix)', () => {
  /** Play exactly one full trick (4 cards) and return the held state. */
  function playOneFullTrick(seed: number): GameState {
    let g = bidAllMinimum(createGame(mulberry32(seed), 0));
    for (let i = 0; i < 4; i++) {
      const seat = g.turn;
      g = playCard(g, seat, legalPlays(g.hands[seat]!, g.currentTrick)[0]!);
    }
    return g;
  }

  it('the 4th card stays visible: playCard leaves all 4 cards in currentTrick', () => {
    const g = playOneFullTrick(30);
    expect(g.phase).toBe('playing');
    expect(g.currentTrick).toHaveLength(4); // all 4 face-up, NOT cleared
    expect(g.tricksWon).toEqual([0, 0, 0, 0]); // not awarded yet
  });

  it('no seat may play while the completed trick is held', () => {
    const g = playOneFullTrick(31);
    for (const seat of [0, 1, 2, 3] as const) {
      const card = g.hands[seat]![0];
      if (card) expect(() => playCard(g, seat, card)).toThrow(RuleViolation);
    }
  });

  it('resolveCompletedTrick awards the winner and clears the pile', () => {
    const g = playOneFullTrick(32);
    const resolved = resolveCompletedTrick(g);
    expect(resolved.currentTrick).toHaveLength(0);
    expect(resolved.tricksWon.reduce((a, b) => a + b, 0)).toBe(1);
    const winner = resolved.tricksWon.findIndex((t) => t === 1);
    expect(resolved.turn).toBe(winner); // winner leads the next trick
    expect(resolved.leadSeat).toBe(winner);
  });

  it('resolveCompletedTrick rejects an incomplete trick', () => {
    let g = bidAllMinimum(createGame(mulberry32(33), 0));
    expect(() => resolveCompletedTrick(g)).toThrow(RuleViolation); // 0 cards
    const seat = g.turn;
    g = playCard(g, seat, legalPlays(g.hands[seat]!, g.currentTrick)[0]!);
    expect(() => resolveCompletedTrick(g)).toThrow(RuleViolation); // 1 card
  });
});

describe('full round & game simulation', () => {
  it('plays a complete round: 13 tricks awarded, hands emptied, round scored', () => {
    const g = autoPlayRound(bidAllMinimum(createGame(mulberry32(20), 0)));
    expect(g.phase).toBe('roundEnd');
    expect(g.tricksWon.reduce((a, b) => a + b, 0)).toBe(13);
    g.hands.forEach((h) => expect(h).toHaveLength(0));
    expect(g.history).toHaveLength(1);
    // Every seat bid the minimum (1); scores must equal the scoring formula.
    const r = g.history[0]!;
    r.tricksWon.forEach((won, seat) => {
      const expected = won >= 1 ? 10 + (won - 1) : -10;
      expect(r.scoreTenths[seat]).toBe(expected);
    });
  });

  it('rotates the dealer each round', () => {
    let g = autoPlayRound(bidAllMinimum(createGame(mulberry32(21), 0)));
    expect(g.dealer).toBe(0);
    g = startNextRound(g, mulberry32(22));
    expect(g.dealer).toBe(1); // rotated clockwise
    expect(g.roundNumber).toBe(2);
    expect(g.phase).toBe('bidding');
  });

  it('plays a full 5-round match to game over with consistent totals', () => {
    const rng = mulberry32(2026);
    const final = autoPlayGame(createGame(rng, 0), rng);
    expect(final.phase).toBe('gameOver');
    expect(final.roundNumber).toBe(5);
    expect(final.history).toHaveLength(5);

    // Cumulative scores equal the sum of per-round scores.
    const summed = [0, 0, 0, 0];
    for (const r of final.history) {
      r.scoreTenths.forEach((s, seat) => (summed[seat]! += s));
    }
    expect(final.scores).toEqual(summed);

    // Each round always distributes exactly 13 tricks.
    for (const r of final.history) {
      expect(r.tricksWon.reduce((a, b) => a + b, 0)).toBe(13);
    }
  });

  it('cannot start the next round until the current one ends', () => {
    const g = bidAllMinimum(createGame(mulberry32(23), 0)); // still playing
    expect(() => startNextRound(g, mulberry32(24))).toThrow(RuleViolation);
  });
});
