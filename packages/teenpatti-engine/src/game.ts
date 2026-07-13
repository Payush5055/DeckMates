/**
 * Pure Teen Patti game state machine.
 *
 * This engine models a single hand of Teen Patti from the first ante (boot)
 * through betting, side shows, and the final show/win. There is intentionally
 * no chip-bankroll system in this build: a room ends at the winner of the hand
 * and the client may "play again" in a fresh room.
 */

import { createDeck, shuffle, sortHand, type Card, type RNG, type Rank } from '@cardadda/engine';
import { compareHands, evaluateHand } from './evaluate';
import {
  BOT_TABLE_SIZE,
  DEFAULT_BOOT,
  HAND_CATEGORY_LABELS,
  HAND_SIZE,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type HandStrength,
  type Seat,
  type TeenPattiMode,
  type Visibility,
} from './types';

export class RuleViolation extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleViolation';
  }
}

export type Phase = 'playing' | 'sideShow' | 'gameOver';

export interface SideShowRequest {
  requester: Seat;
  target: Seat;
  cost: number;
}

export type ActionRecord =
  | { type: 'bet'; seat: Seat; amount: number; visibility: Visibility }
  | { type: 'see'; seat: Seat }
  | { type: 'fold'; seat: Seat }
  | { type: 'sideShowRequested'; requester: Seat; target: Seat; cost: number }
  | { type: 'sideShowRefused'; requester: Seat; target: Seat }
  | { type: 'sideShowAccepted'; requester: Seat; target: Seat; loser: Seat }
  | { type: 'show'; requester: Seat; target: Seat; cost: number; winner: Seat; tie: boolean }
  | { type: 'win'; seat: Seat; reason: 'allFolded' | 'show' | 'sideShow' };

export interface Showdown {
  kind: 'show' | 'sideShow';
  requester: Seat;
  target: Seat;
  winner: Seat;
  loser: Seat;
  tie: boolean;
}

export interface GameState {
  phase: Phase;
  mode: TeenPattiMode;
  numPlayers: number;
  boot: number;
  pot: number;
  currentStake: number;
  jokerRank: Rank | null;
  /** PRIVATE: hidden until a player has "seen" or the hand is over. */
  hands: Card[][];
  active: boolean[];
  seen: boolean[];
  turn: Seat | null;
  pendingSideShow: SideShowRequest | null;
  lastAction: ActionRecord | null;
  eliminationOrder: Seat[];
  winner: Seat | null;
  showdown: Showdown | null;
}

function assertPlayerCount(numPlayers: number): void {
  if (!Number.isInteger(numPlayers) || numPlayers < MIN_PLAYERS || numPlayers > MAX_PLAYERS) {
    throw new RuleViolation(`numPlayers must be an integer between ${MIN_PLAYERS} and ${MAX_PLAYERS}`);
  }
}

function dealHands(numPlayers: number, rng: RNG, mode: TeenPattiMode): { hands: Card[][]; jokerRank: Rank | null } {
  const deck = shuffle(createDeck(), rng);
  const hands: Card[][] = Array.from({ length: numPlayers }, () => []);
  let index = 0;

  for (let card = 0; card < HAND_SIZE; card++) {
    for (let seat = 0; seat < numPlayers; seat++) {
      hands[seat]!.push(deck[index]!);
      index++;
    }
  }

  const jokerRank = mode === 'joker' ? deck[index]!.rank : null;
  return {
    hands: hands.map((hand) => sortHand(hand)),
    jokerRank,
  };
}

export function activeSeats(state: GameState): Seat[] {
  return state.active
    .map((active, seat) => (active ? (seat as Seat) : null))
    .filter((seat): seat is Seat => seat !== null);
}

function remainingActiveCount(state: GameState): number {
  return activeSeats(state).length;
}

function nextActiveSeat(state: GameState, from: Seat): Seat {
  for (let i = 1; i <= state.numPlayers; i++) {
    const seat = ((from + i) % state.numPlayers) as Seat;
    if (state.active[seat]) return seat;
  }
  throw new RuleViolation('No active players remain');
}

function previousActiveSeat(state: GameState, from: Seat): Seat {
  for (let i = 1; i <= state.numPlayers; i++) {
    const seat = (((from - i) % state.numPlayers + state.numPlayers) % state.numPlayers) as Seat;
    if (state.active[seat]) return seat;
  }
  throw new RuleViolation('No active players remain');
}

function onlyOtherActiveSeat(state: GameState, seat: Seat): Seat {
  const others = activeSeats(state).filter((s) => s !== seat);
  if (others.length !== 1) throw new RuleViolation('Show is only allowed when exactly two players remain');
  return others[0]!;
}

function assertOnTurn(state: GameState, seat: Seat): void {
  if (state.phase === 'gameOver') throw new RuleViolation('The hand is over');
  if (state.phase === 'sideShow') throw new RuleViolation('A side show is awaiting response');
  if (!state.active[seat]) throw new RuleViolation('You have already folded');
  if (state.turn !== seat) throw new RuleViolation('It is not your turn');
}

function finishGame(state: GameState, winner: Seat, reason: ActionRecord['type'] extends 'win' ? never : 'show' | 'sideShow' | 'allFolded', showdown: Showdown | null): GameState {
  return {
    ...state,
    phase: 'gameOver',
    turn: null,
    pendingSideShow: null,
    winner,
    showdown,
    lastAction:
      reason === 'allFolded'
        ? { type: 'win', seat: winner, reason: 'allFolded' }
        : showdown && reason === 'show'
          ? {
              type: 'show',
              requester: showdown.requester,
              target: showdown.target,
              cost: state.showdown?.kind === 'show' ? 0 : 0,
              winner: showdown.winner,
              tie: showdown.tie,
            }
          : { type: 'win', seat: winner, reason: 'sideShow' },
  };
}

function resolveWinnerByLastStanding(state: GameState): GameState {
  const alive = activeSeats(state);
  if (alive.length !== 1) return state;
  return {
    ...state,
    phase: 'gameOver',
    turn: null,
    pendingSideShow: null,
    winner: alive[0]!,
    showdown: null,
    lastAction: { type: 'win', seat: alive[0]!, reason: 'allFolded' },
  };
}

export function createGame(
  numPlayers: number,
  mode: TeenPattiMode,
  rng: RNG = Math.random,
  boot = DEFAULT_BOOT,
): GameState {
  assertPlayerCount(numPlayers);
  if (!Number.isInteger(boot) || boot <= 0) throw new RuleViolation('boot must be a positive integer');

  const { hands, jokerRank } = dealHands(numPlayers, rng, mode);

  return {
    phase: 'playing',
    mode,
    numPlayers,
    boot,
    pot: boot * numPlayers,
    currentStake: boot,
    jokerRank,
    hands,
    active: Array.from({ length: numPlayers }, () => true),
    seen: Array.from({ length: numPlayers }, () => false),
    turn: 0 as Seat,
    pendingSideShow: null,
    lastAction: null,
    eliminationOrder: [],
    winner: null,
    showdown: null,
  };
}

export function isBlind(state: GameState, seat: Seat): boolean {
  return !state.seen[seat];
}

export function getBetBounds(state: GameState, seat: Seat): { min: number; max: number } {
  assertOnTurn(state, seat);
  const seen = state.seen[seat];
  return seen
    ? { min: state.currentStake * 2, max: state.currentStake * 4 }
    : { min: state.currentStake, max: state.currentStake * 2 };
}

export function canSeeCards(state: GameState, seat: Seat): boolean {
  return state.phase === 'playing' && state.turn === seat && state.active[seat] && !state.seen[seat];
}

export function getSideShowTarget(state: GameState, seat: Seat): Seat | null {
  if (state.phase !== 'playing' || state.turn !== seat || !state.seen[seat] || remainingActiveCount(state) <= 2) {
    return null;
  }

  let cursor = previousActiveSeat(state, seat);
  for (let i = 0; i < state.numPlayers; i++) {
    if (cursor === seat) return null;
    if (state.active[cursor] && state.seen[cursor]) return cursor;
    cursor = previousActiveSeat(state, cursor);
  }
  return null;
}

export function canRequestShow(state: GameState, seat: Seat): boolean {
  if (state.phase !== 'playing' || state.turn !== seat || !state.active[seat] || remainingActiveCount(state) !== 2) {
    return false;
  }
  const opponent = onlyOtherActiveSeat(state, seat);
  if (!state.seen[seat]) return true;
  return state.seen[opponent];
}

export function showCost(state: GameState, seat: Seat): number {
  if (!canRequestShow(state, seat)) throw new RuleViolation('Show is not allowed right now');
  return state.seen[seat] ? state.currentStake * 2 : state.currentStake;
}

export function visibleHand(state: GameState, seat: Seat): Card[] | null {
  if (state.phase === 'gameOver' || state.seen[seat]) return state.hands[seat]!.slice();
  return null;
}

export function evaluateSeatHand(state: GameState, seat: Seat): HandStrength {
  return evaluateHand(state.hands[seat]!, state.mode, state.jokerRank);
}

export function seeCards(state: GameState, seat: Seat): GameState {
  assertOnTurn(state, seat);
  if (state.seen[seat]) throw new RuleViolation('You have already seen your cards');
  const seen = state.seen.slice();
  seen[seat] = true;
  return {
    ...state,
    seen,
    lastAction: { type: 'see', seat },
  };
}

export function placeBet(state: GameState, seat: Seat, amount: number): GameState {
  assertOnTurn(state, seat);
  if (!Number.isInteger(amount)) throw new RuleViolation('Bets must be whole numbers');
  const { min, max } = getBetBounds(state, seat);
  if (amount < min || amount > max) {
    throw new RuleViolation(`Bet must be between ${min} and ${max}`);
  }

  const visibility: Visibility = state.seen[seat] ? 'seen' : 'blind';
  return {
    ...state,
    pot: state.pot + amount,
    currentStake: visibility === 'blind' ? amount : amount / 2,
    turn: nextActiveSeat(state, seat),
    lastAction: { type: 'bet', seat, amount, visibility },
  };
}

export function fold(state: GameState, seat: Seat): GameState {
  assertOnTurn(state, seat);
  const active = state.active.slice();
  active[seat] = false;
  const eliminationOrder = [...state.eliminationOrder, seat];
  const nextState: GameState = {
    ...state,
    active,
    eliminationOrder,
    turn: nextActiveSeat({ ...state, active }, seat),
    lastAction: { type: 'fold', seat },
  };
  return resolveWinnerByLastStanding(nextState);
}

export function requestSideShow(state: GameState, seat: Seat): GameState {
  assertOnTurn(state, seat);
  const target = getSideShowTarget(state, seat);
  if (target === null) throw new RuleViolation('No eligible side show target');
  const cost = state.currentStake * 2;

  return {
    ...state,
    phase: 'sideShow',
    pot: state.pot + cost,
    pendingSideShow: { requester: seat, target, cost },
    turn: target,
    lastAction: { type: 'sideShowRequested', requester: seat, target, cost },
  };
}

export function respondToSideShow(state: GameState, seat: Seat, accept: boolean): GameState {
  if (state.phase !== 'sideShow' || !state.pendingSideShow) {
    throw new RuleViolation('There is no side show to answer');
  }
  const { requester, target } = state.pendingSideShow;
  if (seat !== target) throw new RuleViolation('Only the requested player can answer the side show');

  if (!accept) {
    return {
      ...state,
      phase: 'playing',
      pendingSideShow: null,
      turn: nextActiveSeat(state, requester),
      lastAction: { type: 'sideShowRefused', requester, target },
    };
  }

  const comparison = compareHands(
    state.hands[requester]!,
    state.hands[target]!,
    state.mode,
    state.jokerRank,
  );
  const loser = comparison <= 0 ? requester : target;
  const active = state.active.slice();
  active[loser] = false;
  const eliminationOrder = [...state.eliminationOrder, loser];
  const survivorState: GameState = {
    ...state,
    phase: 'playing',
    active,
    eliminationOrder,
    pendingSideShow: null,
    turn: nextActiveSeat({ ...state, active }, requester),
    lastAction: { type: 'sideShowAccepted', requester, target, loser },
  };

  if (remainingActiveCount(survivorState) === 1) {
    const winner = activeSeats(survivorState)[0]!;
    return {
      ...survivorState,
      phase: 'gameOver',
      turn: null,
      winner,
      showdown: {
        kind: 'sideShow',
        requester,
        target,
        winner,
        loser,
        tie: comparison === 0,
      },
      lastAction: { type: 'win', seat: winner, reason: 'sideShow' },
    };
  }

  return survivorState;
}

export function requestShow(state: GameState, seat: Seat): GameState {
  assertOnTurn(state, seat);
  if (!canRequestShow(state, seat)) throw new RuleViolation('Show is not allowed right now');

  const target = onlyOtherActiveSeat(state, seat);
  const cost = showCost(state, seat);
  const comparison = compareHands(
    state.hands[seat]!,
    state.hands[target]!,
    state.mode,
    state.jokerRank,
  );
  const tie = comparison === 0;
  const winner = comparison > 0 ? seat : target;
  const loser = winner === seat ? target : seat;
  const active = state.active.slice();
  active[loser] = false;
  const eliminationOrder = [...state.eliminationOrder, loser];

  return {
    ...state,
    phase: 'gameOver',
    pot: state.pot + cost,
    active,
    eliminationOrder,
    turn: null,
    pendingSideShow: null,
    winner,
    showdown: {
      kind: 'show',
      requester: seat,
      target,
      winner,
      loser,
      tie,
    },
    lastAction: { type: 'show', requester: seat, target, cost, winner, tie },
  };
}

export function buildRanking(state: GameState): Seat[] {
  if (state.winner === null) throw new RuleViolation('Cannot build rankings before the hand is over');
  return [state.winner, ...state.eliminationOrder.slice().reverse()];
}

export function defaultBotTableSize(): number {
  return BOT_TABLE_SIZE;
}

export function handCategoryLabel(state: GameState, seat: Seat): string {
  return evaluateSeatHand(state, seat).label ?? HAND_CATEGORY_LABELS[evaluateSeatHand(state, seat).category];
}
