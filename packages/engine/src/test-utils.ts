/**
 * Test-only helpers. Not exported from the package's public index.
 */

import { RNG } from './deck';
import { GameState, playCard, placeBid, resolveCompletedTrick, startNextRound } from './game';
import { legalPlays } from './trick';
import { MIN_BID, NUM_PLAYERS, Seat } from './types';

/**
 * mulberry32 — a tiny, fast, deterministic PRNG. Seeded so every test run deals
 * identical cards and every game plays out identically.
 */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Drive the (simultaneous) bidding phase to completion: every seat bids min. */
export function bidAllMinimum(state: GameState): GameState {
  let s = state;
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    if (s.phase === 'bidding' && s.bids[seat] === null) {
      s = placeBid(s, seat, MIN_BID);
    }
  }
  return s;
}

/**
 * Play out an entire round by always playing the first legal card for whoever's
 * turn it is. Returns the state once the round has ended (roundEnd or gameOver).
 */
export function autoPlayRound(state: GameState): GameState {
  let s = state;
  while (s.phase === 'playing') {
    // A full trick parks in the "all 4 visible" hold state; resolve it to move on.
    if (s.currentTrick.length === NUM_PLAYERS) {
      s = resolveCompletedTrick(s);
      continue;
    }
    const seat = s.turn as Seat;
    const options = legalPlays(s.hands[seat]!, s.currentTrick);
    s = playCard(s, seat, options[0]!);
  }
  return s;
}

/** Play a full 5-round match with minimum bids and first-legal-card play. */
export function autoPlayGame(state: GameState, rng: RNG): GameState {
  let s = state;
  while (s.phase !== 'gameOver') {
    if (s.phase === 'roundEnd') {
      s = startNextRound(s, rng);
    }
    s = bidAllMinimum(s);
    s = autoPlayRound(s);
  }
  return s;
}
