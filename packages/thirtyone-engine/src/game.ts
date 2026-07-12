/**
 * Pure 31 (Scat/Blitz) game state machine.
 *
 * Every transition is a pure function: `(state, action) => newState`. Nothing
 * here imports React or Socket.io. The server owns a `GameState` per room,
 * feeds it player actions, and broadcasts a redacted view (never raw `hands`).
 *
 * A turn = draw ONE card (from the face-down pile or the discard pile), then
 * discard ONE card — the just-drawn card may itself be discarded (locked
 * decision for this build). INSTEAD of drawing, a player may KNOCK: that uses
 * their whole turn, and every other living player gets exactly one final turn
 * before all hands are revealed and the lowest hand loses a life (the knocker
 * loses 2 if THEY are lowest; if the knocker ties for lowest, only the tied
 * non-knockers lose 1). A hand worth exactly 31 — including straight off the
 * deal — ends the round instantly: everyone else loses a life, no more turns.
 *
 * Lives: 3 each; 0 = eliminated. Rounds rotate their starting seat clockwise,
 * skipping eliminated players. Last player alive wins.
 */

import { createDeck, shuffle, type RNG } from '@cardadda/engine';
import {
  HAND_SIZE,
  NUM_PLAYERS,
  STARTING_LIVES,
  TARGET_VALUE,
  type Card,
  type Seat,
} from './types';
import { handValue } from './scoring';

/** Thrown for illegal actions (wrong turn, wrong stage, bad card, …). */
export class RuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleViolation';
  }
}

export type Phase = 'playing' | 'roundEnd' | 'gameOver';
/** Within a turn: first you draw (or knock), then you discard. */
export type TurnStage = 'draw' | 'discard';

/** Immutable record of a completed round — powers the reveal screen. */
export interface RoundOutcome {
  readonly roundNumber: number;
  readonly reason: 'knock' | 'instant31';
  readonly knockerSeat: Seat | null;
  /** Seats holding exactly 31 (instant31 rounds only; they never lose a life). */
  readonly winners31: readonly Seat[];
  /** All hands face-up, by seat; null for players eliminated before the round. */
  readonly revealedHands: readonly (readonly Card[] | null)[];
  readonly handValues: readonly (number | null)[];
  /** Lives lost this round per seat (0, 1, or 2). */
  readonly livesLost: readonly number[];
  readonly livesAfter: readonly number[];
  /** True when the knocker was strictly lowest and lost 2 lives. */
  readonly doublePenalty: boolean;
  /** True when applying losses would have eliminated everyone: no lives change,
   * the round is simply replayed (locked decision for this build). */
  readonly voided: boolean;
}

export interface GameState {
  phase: Phase;
  roundNumber: number;
  /** Seat that opened the current round; rotates clockwise, skipping the dead. */
  roundStarter: Seat;
  /** Lives per seat; 0 = eliminated. */
  lives: number[];
  /** Round in which each seat was eliminated (null while alive). */
  eliminationRound: (number | null)[];
  /** PRIVATE: 3 cards each (4 mid-turn); empty for eliminated seats. */
  hands: Card[][];
  drawPile: Card[];
  /** Full discard history; the last entry is the face-up top card. */
  discardPile: Card[];
  turn: Seat;
  stage: TurnStage;
  knocker: Seat | null;
  /** After a knock: how many players still owe their one final turn. */
  finalTurnsRemaining: number | null;
  history: RoundOutcome[];
}

/* ── Seat helpers ───────────────────────────────────────────────────────────── */

export function aliveSeats(lives: readonly number[]): Seat[] {
  return ([0, 1, 2, 3] as Seat[]).filter((s) => (lives[s] ?? 0) > 0);
}

/** Next living seat clockwise after `from`. Throws if nobody is alive. */
export function nextAliveSeat(lives: readonly number[], from: Seat): Seat {
  for (let i = 1; i <= NUM_PLAYERS; i++) {
    const s = ((from + i) % NUM_PLAYERS) as Seat;
    if ((lives[s] ?? 0) > 0) return s;
  }
  throw new RuleViolation('No living players remain');
}

/* ── Dealing ────────────────────────────────────────────────────────────────── */

function dealRound(
  roundNumber: number,
  starter: Seat,
  lives: readonly number[],
  rng: RNG,
): Pick<
  GameState,
  | 'phase'
  | 'roundNumber'
  | 'roundStarter'
  | 'hands'
  | 'drawPile'
  | 'discardPile'
  | 'turn'
  | 'stage'
  | 'knocker'
  | 'finalTurnsRemaining'
> {
  const deck = shuffle(createDeck(), rng);
  const hands: Card[][] = [[], [], [], []];
  let i = 0;
  for (let n = 0; n < HAND_SIZE; n++) {
    for (const seat of aliveSeats(lives)) {
      hands[seat]!.push(deck[i]!);
      i++;
    }
  }
  const discardPile = [deck[i]!];
  const drawPile = deck.slice(i + 1);
  return {
    phase: 'playing',
    roundNumber,
    roundStarter: starter,
    hands,
    drawPile,
    discardPile,
    turn: starter,
    stage: 'draw',
    knocker: null,
    finalTurnsRemaining: null,
  };
}

/** Create a fresh 4-player game: 3 lives each, round 1 dealt, seat 0 starts.
 * If anyone is DEALT exactly 31, the round resolves immediately (spec). */
export function createGame(rng: RNG = Math.random): GameState {
  const lives = new Array(NUM_PLAYERS).fill(STARTING_LIVES) as number[];
  const state: GameState = {
    ...dealRound(1, 0 as Seat, lives, rng),
    lives,
    eliminationRound: [null, null, null, null],
    history: [],
  };
  return checkInstant31(state);
}

/* ── Instant 31 ─────────────────────────────────────────────────────────────── */

/**
 * If any living player's resting 3-card hand is worth exactly 31, the round
 * ends right here: every OTHER living player loses a life (all simultaneous
 * 31-holders are safe). No further turns. Returns the state unchanged when
 * nobody has 31. Exported so the deal-31 path is unit-testable directly.
 */
export function checkInstant31(state: GameState): GameState {
  if (state.phase !== 'playing') return state;
  const winners = aliveSeats(state.lives).filter(
    (s) => state.hands[s]!.length === HAND_SIZE && handValue(state.hands[s]!) === TARGET_VALUE,
  );
  if (winners.length === 0) return state;

  const livesLost = state.lives.map((l, s) =>
    l > 0 && !winners.includes(s as Seat) ? 1 : 0,
  );
  return settleRound(state, {
    reason: 'instant31',
    winners31: winners,
    livesLost,
    doublePenalty: false,
  });
}

/* ── Turn actions ───────────────────────────────────────────────────────────── */

function assertOnTurn(state: GameState, seat: Seat, stage: TurnStage): void {
  if (state.phase !== 'playing') throw new RuleViolation('Not in the playing phase');
  if (state.turn !== seat) throw new RuleViolation('It is not your turn');
  if (state.stage !== stage) {
    throw new RuleViolation(stage === 'draw' ? 'You have already drawn — discard a card' : 'Draw (or knock) first');
  }
}

/**
 * KNOCK — replaces the entire turn (no draw, no discard). Only allowed at the
 * start of your turn, and only if nobody has knocked yet. Every other living
 * player then gets exactly one final turn before the reveal.
 */
export function knock(state: GameState, seat: Seat): GameState {
  assertOnTurn(state, seat, 'draw');
  if (state.knocker !== null) throw new RuleViolation('Someone has already knocked');
  return {
    ...state,
    knocker: seat,
    finalTurnsRemaining: aliveSeats(state.lives).length - 1,
    turn: nextAliveSeat(state.lives, seat),
    stage: 'draw',
  };
}

/**
 * Draw one card from the face-down pile ('pile') or the discard pile
 * ('discard'). If the face-down pile is empty it is replenished by shuffling
 * the discard pile beneath its top card (standard convention; flagged).
 */
export function draw(state: GameState, seat: Seat, source: 'pile' | 'discard', rng: RNG = Math.random): GameState {
  assertOnTurn(state, seat, 'draw');

  let drawPile = state.drawPile.slice();
  let discardPile = state.discardPile.slice();
  let card: Card;

  if (source === 'discard') {
    if (discardPile.length === 0) throw new RuleViolation('The discard pile is empty');
    card = discardPile.pop()!;
  } else {
    if (drawPile.length === 0 && discardPile.length > 1) {
      const top = discardPile.pop()!;
      drawPile = shuffle(discardPile, rng);
      discardPile = [top];
    }
    if (drawPile.length === 0) throw new RuleViolation('No cards left to draw — take the discard');
    card = drawPile.pop()!;
  }

  const hands = state.hands.map((h, s) => (s === seat ? [...h, card] : h));
  return { ...state, hands, drawPile, discardPile, stage: 'discard' };
}

/**
 * Discard one of the four held cards (the just-drawn card is allowed — locked
 * decision). If the resting 3-card hand is now worth exactly 31, the round
 * ends instantly. Otherwise the turn passes; after a knock this also counts
 * down the final turns, triggering the reveal when the last one completes.
 */
export function discard(state: GameState, seat: Seat, card: Card): GameState {
  assertOnTurn(state, seat, 'discard');
  const hand = state.hands[seat]!;
  const idx = hand.findIndex((c) => c.suit === card.suit && c.rank === card.rank);
  if (idx < 0) throw new RuleViolation('You do not hold that card');

  const newHand = hand.slice();
  newHand.splice(idx, 1);
  const hands = state.hands.map((h, s) => (s === seat ? newHand : h));
  const discardPile = [...state.discardPile, card];
  let next: GameState = { ...state, hands, discardPile };

  // Instant 31 trumps everything — including a knock's pending reveal.
  next = checkInstant31(next);
  if (next.phase !== 'playing') return next;

  if (next.knocker !== null) {
    const remaining = (next.finalTurnsRemaining ?? 1) - 1;
    if (remaining <= 0) return resolveKnockReveal(next);
    return {
      ...next,
      finalTurnsRemaining: remaining,
      turn: nextAliveSeat(next.lives, seat),
      stage: 'draw',
    };
  }
  return { ...next, turn: nextAliveSeat(next.lives, seat), stage: 'draw' };
}

/* ── Reveal & life loss ─────────────────────────────────────────────────────── */

/**
 * After the knock's final turns: reveal all hands; the lowest value loses a
 * life — except the knocker loses 2 if strictly lowest, and if the knocker
 * TIES for lowest only the tied non-knockers lose 1. Ties among non-knockers
 * all lose 1 each.
 */
function resolveKnockReveal(state: GameState): GameState {
  const alive = aliveSeats(state.lives);
  const knocker = state.knocker!;
  const values = new Map<Seat, number>(alive.map((s) => [s, handValue(state.hands[s]!)]));
  const min = Math.min(...values.values());
  const lowest = alive.filter((s) => values.get(s) === min);

  const livesLost = new Array(NUM_PLAYERS).fill(0) as number[];
  let doublePenalty = false;
  if (lowest.includes(knocker)) {
    if (lowest.length === 1) {
      livesLost[knocker] = 2; // knocked and lost — double penalty
      doublePenalty = true;
    } else {
      for (const s of lowest) if (s !== knocker) livesLost[s] = 1; // knocker safe on tie
    }
  } else {
    for (const s of lowest) livesLost[s] = 1;
  }

  return settleRound(state, { reason: 'knock', winners31: [], livesLost, doublePenalty });
}

/**
 * Apply a round's life losses, record the outcome, and set the next phase.
 * If the losses would eliminate EVERY living player at once, the round is
 * voided instead: nothing changes and it is simply replayed. (With the
 * knocker-safe-on-tie rule this is unreachable in practice, but the guard is
 * kept as a defensive invariant.)
 */
function settleRound(
  state: GameState,
  opts: {
    reason: 'knock' | 'instant31';
    winners31: Seat[];
    livesLost: number[];
    doublePenalty: boolean;
  },
): GameState {
  const alive = aliveSeats(state.lives);
  const proposed = state.lives.map((l, s) => Math.max(0, l - opts.livesLost[s]!));
  const voided = alive.every((s) => proposed[s] === 0);

  const lives = voided ? state.lives.slice() : proposed;
  const livesLost = voided ? new Array(NUM_PLAYERS).fill(0) : opts.livesLost;
  const eliminationRound = state.eliminationRound.map((r, s) =>
    r === null && lives[s] === 0 && state.lives[s]! > 0 ? state.roundNumber : r,
  );

  const outcome: RoundOutcome = {
    roundNumber: state.roundNumber,
    reason: opts.reason,
    knockerSeat: state.knocker,
    winners31: opts.winners31,
    revealedHands: state.hands.map((h, s) => (alive.includes(s as Seat) ? h.slice() : null)),
    handValues: state.hands.map((h, s) => (alive.includes(s as Seat) ? handValue(h) : null)),
    livesLost,
    livesAfter: lives.slice(),
    doublePenalty: voided ? false : opts.doublePenalty,
    voided,
  };

  return {
    ...state,
    lives,
    eliminationRound,
    history: [...state.history, outcome],
    phase: aliveSeats(lives).length <= 1 ? 'gameOver' : 'roundEnd',
  };
}

/** Deal the next round after a `roundEnd` pause: the starting seat advances
 * clockwise (skipping eliminated players); lives and history carry over. */
export function startNextRound(state: GameState, rng: RNG = Math.random): GameState {
  if (state.phase !== 'roundEnd') throw new RuleViolation('The round is not over yet');
  const starter = nextAliveSeat(state.lives, state.roundStarter);
  const next: GameState = {
    ...dealRound(state.roundNumber + 1, starter, state.lives, rng),
    lives: state.lives.slice(),
    eliminationRound: state.eliminationRound.slice(),
    history: state.history.slice(),
  };
  return checkInstant31(next);
}
