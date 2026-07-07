/**
 * Pure Crazy 8s game state machine.
 *
 * Every transition is a pure function: `(state, action) => newState`. Nothing
 * here imports React or Socket.io. The server owns a `GameState` per room, feeds
 * it player actions, and broadcasts a redacted view (never the raw `hands`).
 *
 * Phases: playing → (roundEnd → playing)* → gameOver
 *
 * Turn order is clockwise and never reverses — there is no skip/reverse/draw-2
 * mechanic in this ruleset, only the wild 8. The starting seat rotates by one
 * position each round (round 1 → seat 0, round 2 → seat 1, …).
 */

import { SUITS, WILD_RANK, nextSeat, type Card, type Seat, type Suit } from './types';
import { RNG, dealInitial, reshuffleDiscardIntoDraw } from './deck';
import { isLegalPlay, legalPlays } from './rules';
import { isGameOver, scoreRound } from './scoring';

/** Thrown for illegal actions (wrong turn, illegal card, bad seat, …). */
export class RuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleViolation';
  }
}

export type Phase = 'playing' | 'roundEnd' | 'gameOver';

/** Immutable record of a completed round, used for result screens & history. */
export interface RoundResult {
  readonly roundNumber: number;
  readonly winnerSeat: Seat;
  /** Points each seat scored THIS round (0 for the winner), indexed by seat. */
  readonly pointsThisRound: readonly number[];
  /** Running cumulative total per seat after this round, indexed by seat. */
  readonly cumulativeScores: readonly number[];
}

export interface GameState {
  phase: Phase;
  numPlayers: number;
  /** Current round, 1-based. */
  roundNumber: number;
  /** PRIVATE: each seat's remaining cards. Never broadcast raw — redact first. */
  hands: Card[][];
  drawPile: Card[];
  /** Full discard history; the last entry is the literal top (face-up) card. */
  discardPile: Card[];
  /**
   * The suit currently required to match. Equal to the top card's own suit
   * UNLESS an 8 is on top, in which case it's whatever suit was declared —
   * tracked separately since the two can differ.
   */
  requiredSuit: Suit;
  turn: Seat;
  /** Cumulative score per seat across the match (lower is better). */
  scores: number[];
  /** Completed-round results, oldest first. */
  history: RoundResult[];
}

/** The literal face-up top card of the discard pile. */
export function topCard(state: GameState): Card {
  return state.discardPile[state.discardPile.length - 1]!;
}

function beginRound(roundNumber: number, startSeat: Seat, numPlayers: number, rng: RNG) {
  const { hands, drawPile, topCard: starter } = dealInitial(numPlayers, rng);
  return {
    phase: 'playing' as Phase,
    roundNumber,
    hands,
    drawPile,
    discardPile: [starter],
    requiredSuit: starter.suit,
    turn: startSeat,
  };
}

/** Create a fresh game for `numPlayers` (2–4): round 1, dealt, zeroed scores. */
export function createGame(numPlayers: number, rng: RNG = Math.random): GameState {
  if (!Number.isInteger(numPlayers) || numPlayers < 2 || numPlayers > 4) {
    throw new RuleViolation('numPlayers must be an integer between 2 and 4');
  }
  return {
    ...beginRound(1, 0 as Seat, numPlayers, rng),
    numPlayers,
    scores: new Array(numPlayers).fill(0) as number[],
    history: [],
  };
}

/**
 * Play `card` from `seat`. Enforces turn order and legality (follow suit or
 * rank of the top card, or play a wild 8). Playing an 8 requires `declaredSuit`
 * — the suit that becomes required next, independent of the 8's own suit.
 *
 * If this empties the seat's hand, the round ends immediately: every other
 * seat scores the value of their remaining cards, added to their cumulative
 * total (winner scores 0). If any cumulative total is now >= 100, the game
 * ends this instant; otherwise the round pauses at `roundEnd` awaiting
 * `startNextRound`.
 */
export function playCard(state: GameState, seat: Seat, card: Card, declaredSuit?: Suit): GameState {
  if (state.phase !== 'playing') throw new RuleViolation('Not in the playing phase');
  if (seat !== state.turn) throw new RuleViolation('It is not your turn to play');

  const hand = state.hands[seat];
  if (!hand) throw new RuleViolation('Invalid seat');
  const top = topCard(state);
  if (!isLegalPlay(hand, top, state.requiredSuit, card)) {
    throw new RuleViolation('Illegal card: must match the suit in play or the top card’s rank (or play an 8)');
  }

  let nextRequiredSuit: Suit;
  if (card.rank === WILD_RANK) {
    if (!declaredSuit || !SUITS.includes(declaredSuit)) {
      throw new RuleViolation('Playing an 8 requires declaring a valid suit');
    }
    nextRequiredSuit = declaredSuit;
  } else {
    nextRequiredSuit = card.suit;
  }

  const hands = state.hands.map((h) => h.slice());
  const handAfter = hands[seat]!;
  handAfter.splice(
    handAfter.findIndex((c) => c.suit === card.suit && c.rank === card.rank),
    1,
  );
  const discardPile = [...state.discardPile, card];

  if (handAfter.length === 0) {
    // Round over: score it. Winner scores 0; everyone else scores their hand.
    const pointsThisRound = scoreRound(hands, seat);
    const scores = state.scores.map((s, i) => s + pointsThisRound[i]!);
    const result: RoundResult = {
      roundNumber: state.roundNumber,
      winnerSeat: seat,
      pointsThisRound,
      cumulativeScores: scores.slice(),
    };
    const gameOver = isGameOver(scores);
    return {
      ...state,
      hands,
      discardPile,
      requiredSuit: nextRequiredSuit,
      scores,
      history: [...state.history, result],
      phase: gameOver ? 'gameOver' : 'roundEnd',
    };
  }

  return {
    ...state,
    hands,
    discardPile,
    requiredSuit: nextRequiredSuit,
    turn: nextSeat(seat, state.numPlayers),
  };
}

/**
 * `seat` has no legal play and must draw. Draws one card at a time, checking
 * after each: the moment a drawn card is playable, drawing stops immediately
 * (turn stays on this seat — they must submit an ordinary `playCard` next). If
 * none of up to 3 draws are playable, the turn passes and the seat keeps all
 * drawn cards. Reshuffles the discard pile (beneath the top card) into a fresh
 * draw pile if the draw pile runs dry mid-draw.
 */
export function drawUpToThree(state: GameState, seat: Seat): GameState {
  if (state.phase !== 'playing') throw new RuleViolation('Not in the playing phase');
  if (seat !== state.turn) throw new RuleViolation('It is not your turn to draw');

  const hand = state.hands[seat];
  if (!hand) throw new RuleViolation('Invalid seat');
  if (legalPlays(hand, topCard(state), state.requiredSuit).length > 0) {
    throw new RuleViolation('You have a legal play — you must play it instead of drawing');
  }

  let drawPile = state.drawPile.slice();
  let discardPile = state.discardPile.slice();
  const newHand = hand.slice();
  let foundPlayable = false;

  for (let i = 0; i < 3; i++) {
    if (drawPile.length === 0) {
      const reshuffled = reshuffleDiscardIntoDraw(discardPile);
      drawPile = reshuffled.drawPile;
      discardPile = reshuffled.discardPile;
      if (drawPile.length === 0) break; // no cards left anywhere (pathological)
    }
    const drawn = drawPile.pop()!;
    newHand.push(drawn);
    if (isLegalPlay(newHand, discardPile[discardPile.length - 1]!, state.requiredSuit, drawn)) {
      foundPlayable = true;
      break;
    }
  }

  const hands = state.hands.map((h, i) => (i === seat ? newHand : h));

  if (foundPlayable) {
    // Stop drawing; turn stays with this seat to play the now-legal card.
    return { ...state, hands, drawPile, discardPile };
  }
  // Exhausted the draws with nothing playable: turn passes, cards are kept.
  return { ...state, hands, drawPile, discardPile, turn: nextSeat(seat, state.numPlayers) };
}

/**
 * Deal the next round after a `roundEnd` pause. Rotates the starting seat by
 * one position (round N starts at seat (N-1) % numPlayers) and preserves
 * cumulative scores and history.
 */
export function startNextRound(state: GameState, rng: RNG = Math.random): GameState {
  if (state.phase !== 'roundEnd') throw new RuleViolation('The round is not over yet');
  const roundNumber = state.roundNumber + 1;
  const startSeat = ((roundNumber - 1) % state.numPlayers) as Seat;
  return {
    ...beginRound(roundNumber, startSeat, state.numPlayers, rng),
    numPlayers: state.numPlayers,
    scores: state.scores.slice(),
    history: state.history.slice(),
  };
}
