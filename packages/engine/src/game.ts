/**
 * Pure Callbreak game state machine.
 *
 * Every transition is a pure function: `(state, action) => newState`. Nothing
 * here imports React or Socket.io. The server owns a `GameState` per room, feeds
 * it player actions, and broadcasts a redacted view (never the raw `hands`).
 *
 * Phases: bidding → playing → (roundEnd → bidding)×4 → gameOver
 */

import {
  Card,
  MAX_BID,
  MIN_BID,
  NUM_PLAYERS,
  Seat,
  TOTAL_ROUNDS,
  nextSeat,
} from './types';
import { RNG, createShuffledHands } from './deck';
import { TrickPlay, isLegalPlay, resolveTrick } from './trick';
import { roundScoreTenths } from './scoring';

/** Thrown for illegal actions (wrong turn, illegal card, bad bid, …). */
export class RuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleViolation';
  }
}

export type Phase = 'bidding' | 'playing' | 'roundEnd' | 'gameOver';

/** Immutable record of a completed round, used for result screens & history. */
export interface RoundResult {
  readonly roundNumber: number;
  readonly bids: readonly number[];
  readonly tricksWon: readonly number[];
  /** This round's score per seat, in tenths. */
  readonly scoreTenths: readonly number[];
  /** Running total per seat after this round, in tenths. */
  readonly cumulativeTenths: readonly number[];
}

export interface GameState {
  phase: Phase;
  /** Current round, 1..TOTAL_ROUNDS. */
  roundNumber: number;
  /** Dealer seat for the current round; rotates clockwise each round. */
  dealer: Seat;
  /** PRIVATE: each seat's remaining cards. Never broadcast raw — redact first. */
  hands: Card[][];
  /** Bid per seat; null until that seat has bid this round. */
  bids: (number | null)[];
  /** Tricks won per seat this round. */
  tricksWon: number[];
  /** Cards played into the in-progress trick, in play order. */
  currentTrick: TrickPlay[];
  /** Seat that led the current trick. */
  leadSeat: Seat;
  /** Whose turn it is to act (bid during bidding, play during playing). */
  turn: Seat;
  /** Cumulative score per seat across the match, in tenths. */
  scores: number[];
  /** Completed-round results, oldest first. */
  history: RoundResult[];
}

/**
 * Build the per-round portion of state: shuffle & deal, reset bids/tricks, and
 * set the first actor. The first bidder (and first leader) is the seat to the
 * dealer's left, i.e. dealer + 1.
 */
function beginRound(roundNumber: number, dealer: Seat, rng: RNG) {
  const first = nextSeat(dealer);
  return {
    phase: 'bidding' as Phase,
    roundNumber,
    dealer,
    hands: createShuffledHands(rng),
    bids: [null, null, null, null] as (number | null)[],
    tricksWon: [0, 0, 0, 0],
    currentTrick: [] as TrickPlay[],
    leadSeat: first,
    turn: first,
  };
}

/** Create a fresh game: round 1, bidding phase, zeroed scores. */
export function createGame(rng: RNG = Math.random, startingDealer: Seat = 0): GameState {
  return {
    ...beginRound(1, startingDealer, rng),
    scores: [0, 0, 0, 0],
    history: [],
  };
}

/**
 * Place a bid for `seat`. Bidding is SIMULTANEOUS and blind: any seat may bid at
 * any time (there is no bidding turn order), each seat once. The engine records
 * the value but never reveals it — hiding bids from other players until all four
 * are in is the transport layer's job (see the server's redaction). When the
 * fourth bid lands, the phase flips to `playing` and the first leader is on.
 */
export function placeBid(state: GameState, seat: Seat, bid: number): GameState {
  if (state.phase !== 'bidding') throw new RuleViolation('Not in the bidding phase');
  if (state.bids[seat] !== null) throw new RuleViolation('You have already bid this round');
  if (!Number.isInteger(bid) || bid < MIN_BID || bid > MAX_BID) {
    throw new RuleViolation(`Bid must be a whole number from ${MIN_BID} to ${MAX_BID}`);
  }

  const bids = state.bids.slice();
  bids[seat] = bid;
  const allBidsIn = bids.every((b) => b !== null);

  return {
    ...state,
    bids,
    phase: allBidsIn ? 'playing' : 'bidding',
    // `turn` has no meaning during simultaneous bidding; once complete, the
    // first leader (left of dealer) plays first.
    turn: state.leadSeat,
  };
}

/**
 * Play `card` from `seat` into the current trick. Enforces turn order and the
 * relaxed follow-suit rule.
 *
 * IMPORTANT: when the fourth card lands, the trick is NOT resolved here. The
 * returned state keeps all 4 cards face-up in `currentTrick` so the transport
 * layer can broadcast (and briefly hold) the completed trick for players to
 * see. Resolution — picking the winner, awarding the trick, ending the round —
 * happens in the separate `resolveCompletedTrick()` step.
 */
export function playCard(state: GameState, seat: Seat, card: Card): GameState {
  if (state.phase !== 'playing') throw new RuleViolation('Not in the playing phase');
  if (state.currentTrick.length >= NUM_PLAYERS) {
    throw new RuleViolation('The trick is being resolved');
  }
  if (seat !== state.turn) throw new RuleViolation('It is not your turn to play');

  const hand = state.hands[seat]!;
  if (!isLegalPlay(hand, state.currentTrick, card)) {
    throw new RuleViolation('Illegal card: follow suit, and beat the trick, when you can');
  }

  // Remove the played card from the seat's hand (clone hands for immutability).
  const hands = state.hands.map((h) => h.slice());
  const handAfter = hands[seat]!;
  handAfter.splice(
    handAfter.findIndex((c) => c.suit === card.suit && c.rank === card.rank),
    1,
  );
  const currentTrick: TrickPlay[] = [...state.currentTrick, { seat, card }];

  // Trick still in progress: pass turn clockwise.
  if (currentTrick.length < NUM_PLAYERS) {
    return { ...state, hands, currentTrick, turn: nextSeat(seat) };
  }

  // Trick complete: leave all 4 cards visible and freeze the turn. Nobody can
  // act until resolveCompletedTrick() runs (guarded at the top of this fn).
  return { ...state, hands, currentTrick };
}

/**
 * Resolve a COMPLETED trick (all 4 cards played): award it to the winner, clear
 * the pile, and either continue (winner leads), end the round (scoring it), or
 * end the game. Called by the server after it has broadcast — and deliberately
 * held — the all-4-cards-visible state produced by the final `playCard`.
 */
export function resolveCompletedTrick(state: GameState): GameState {
  if (state.phase !== 'playing') throw new RuleViolation('Not in the playing phase');
  if (state.currentTrick.length !== NUM_PLAYERS) {
    throw new RuleViolation('The trick is not complete yet');
  }

  const winner = resolveTrick(state.currentTrick);
  const tricksWon = state.tricksWon.slice();
  tricksWon[winner] += 1;

  const roundOver = state.hands.every((h) => h.length === 0);
  if (!roundOver) {
    // Winner leads the next trick.
    return {
      ...state,
      currentTrick: [],
      tricksWon,
      leadSeat: winner,
      turn: winner,
    };
  }

  // Round over: score it. All bids are guaranteed set by the playing phase.
  const bids = state.bids.map((b) => b as number);
  const scoreTenths = bids.map((b, i) => roundScoreTenths(b, tricksWon[i]!));
  const scores = state.scores.map((s, i) => s + scoreTenths[i]!);
  const result: RoundResult = {
    roundNumber: state.roundNumber,
    bids,
    tricksWon: tricksWon.slice(),
    scoreTenths,
    cumulativeTenths: scores.slice(),
  };

  const gameOver = state.roundNumber >= TOTAL_ROUNDS;
  return {
    ...state,
    currentTrick: [],
    tricksWon,
    scores,
    history: [...state.history, result],
    phase: gameOver ? 'gameOver' : 'roundEnd',
    leadSeat: winner,
    turn: winner,
  };
}

/**
 * Deal the next round after a `roundEnd` pause (the server typically shows the
 * round-result screen briefly, then calls this). Rotates the dealer clockwise
 * and preserves cumulative scores and history.
 */
export function startNextRound(state: GameState, rng: RNG = Math.random): GameState {
  if (state.phase !== 'roundEnd') throw new RuleViolation('The round is not over yet');
  const dealer = nextSeat(state.dealer);
  return {
    ...beginRound(state.roundNumber + 1, dealer, rng),
    scores: state.scores.slice(),
    history: state.history.slice(),
  };
}
