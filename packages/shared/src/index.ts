/**
 * @cardadda/shared — the wire contract between the Socket.io server and clients.
 *
 * These types define exactly what crosses the network. The single most important
 * rule of this file: the shapes a CLIENT receives (`PublicRoomState`,
 * `SelfState`) expose other players' card *counts* — never their cards. Only
 * `SelfState.hand` carries actual cards, and it is sent solely to its owner.
 */

import type { Card, Seat, Phase } from '@cardadda/engine';
import type {
  Card as Crazy8Card,
  Seat as Crazy8Seat,
  Suit as Crazy8Suit,
} from '@cardadda/crazy8-engine';

export type { Card, Seat } from '@cardadda/engine';
// Re-export the display/value helpers the UI needs so clients can import them
// from a single place alongside the wire types.
export { cardId, RANK_LABELS, SUIT_LABELS } from '@cardadda/engine';

/** Room lifecycle phase: 'waiting' before the 4th player, then engine phases. */
export type RoomPhase = 'waiting' | Phase;

/** Public, per-player info visible to everyone at the table. NO cards here. */
export interface PublicPlayer {
  seat: Seat;
  name: string;
  avatar: string;
  connected: boolean;
  isHost: boolean;
  /** True for a server-controlled bot seat. */
  isBot: boolean;
  /** How many cards this player holds — a count only, never the cards. */
  cardCount: number;
  /**
   * This player's bid. Blind during bidding: stays `null` for everyone until all
   * four bids are in (phase → playing), then the real values are revealed.
   */
  bid: number | null;
  /** Whether this seat has submitted a bid — safe to reveal while bids stay blind. */
  hasBid: boolean;
  tricksWon: number;
}

/** A card played face-up into the current trick — public to the table. */
export interface TrickCard {
  seat: Seat;
  card: Card;
}

/** Shared table state broadcast to every client. Contains no private hands. */
export interface PublicRoomState {
  roomCode: string;
  phase: RoomPhase;
  /** Seated players ordered by seat (0..3). */
  players: PublicPlayer[];
  seatsFilled: number;
  roundNumber: number;
  totalRounds: number;
  dealer: Seat | null;
  leadSeat: Seat | null;
  /** Seat whose turn it is to act, or null when nobody is on the clock. */
  turn: Seat | null;
  currentTrick: TrickCard[];
  /** Cumulative score per seat, in integer tenths (display = /10). */
  scores: number[];
  hostPlayerId: string;
}

/** The personalized slice sent only to its owner — the ONLY carrier of cards. */
export interface SelfState {
  playerId: string;
  seat: Seat;
  /** This recipient's own hand. Never includes anyone else's cards. */
  hand: Card[];
  /** Cards currently legal to play (empty unless it's this player's turn). */
  legalPlays: Card[];
  /** This player's OWN bid this round (always visible to themselves), or null. */
  bid: number | null;
}

/** Payload of every `room_state_update`: shared state + your private slice. */
export interface RoomStateUpdate {
  room: PublicRoomState;
  self: SelfState | null;
}

export interface RoundResultPayload {
  roundNumber: number;
  bids: number[];
  tricksWon: number[];
  scoreTenths: number[];
  cumulativeTenths: number[];
  /** Player display names indexed by seat, for convenient rendering. */
  playerNames: string[];
  /** Whether each seat (by index) is a bot. */
  isBot: boolean[];
}

export interface FinalStanding {
  seat: Seat;
  playerId: string;
  name: string;
  isBot: boolean;
  totalTenths: number;
  /** 1-based placement; tied totals share a rank. */
  rank: number;
}

export interface GameOverPayload {
  standings: FinalStanding[];
  rounds: RoundResultPayload[];
}

/* ── Client → Server request/ack payloads ─────────────────────────────────── */

// Identity (user id + username) is derived from the authenticated socket
// handshake and verified server-side — clients never send it. The only payload
// is the table mode chosen before creation.
export interface CreateRoomReq {
  /**
   * 'bots' — fill all 3 other seats with bots and start immediately (no waiting
   * room). 'teammates' — wait for `teammates` real players to join, then fill
   * any remaining seats with bots and start.
   */
  mode: 'bots' | 'teammates';
  /** For 'teammates' mode: how many real teammates to wait for (1–3). */
  teammates?: number;
}
export interface CreateRoomRes {
  ok: boolean;
  roomCode?: string;
  error?: string;
}

export interface JoinRoomReq {
  roomCode: string;
}
export interface JoinRoomRes {
  ok: boolean;
  seat?: Seat;
  error?: string;
}

export interface PlaceBidReq {
  bid: number;
}
export interface PlayCardReq {
  card: Card;
}
export interface PlayAgainRes {
  ok: boolean;
  roomCode?: string;
  error?: string;
}

export interface ErrorMessagePayload {
  message: string;
}
export interface PlayAgainRoomPayload {
  roomCode: string;
}

/* ── History persistence records ──────────────────────────────────────────── */

export interface MatchPlayerRecord {
  playerId: string;
  name: string;
  seat: Seat;
  totalTenths: number;
  rank: number;
}

/** A completed Callbreak match, as written to history on game over. */
export interface CallbreakMatchRecord {
  id?: string;
  gameType: 'callbreak';
  roomCode: string;
  /** ISO 8601 timestamp of when the match finished. */
  playedAt: string;
  players: MatchPlayerRecord[];
  rounds: RoundResultPayload[];
}

/**
 * History is shared across games via one `matches` table (see
 * server/supabase/schema.sql), discriminated by `gameType`. Add a new arm here
 * when a new game gains history persistence.
 */
export type MatchRecord = CallbreakMatchRecord | Crazy8MatchRecord;

/* ── Event name constants (single source of truth) ────────────────────────── */

export const ClientEvents = {
  CreateRoom: 'create_room',
  JoinRoom: 'join_room',
  PlaceBid: 'place_bid',
  PlayCard: 'play_card',
  LeaveRoom: 'leave_room',
  PlayAgain: 'play_again',
} as const;

export const ServerEvents = {
  RoomStateUpdate: 'room_state_update',
  RoundResult: 'round_result',
  GameOver: 'game_over',
  ErrorMessage: 'error_message',
  PlayAgainRoom: 'play_again_room',
} as const;

/* ═════════════════════════════════════════════════════════════════════════
 * Crazy 8s — a second, independently-shaped game. Distinct event names avoid
 * any collision with Callbreak's on the same authenticated socket connection.
 * Tables seat 2–4 players (variable), unlike Callbreak's fixed 4.
 * ═════════════════════════════════════════════════════════════════════════ */

/** Public, per-seat info visible to everyone. NO cards here. */
export interface Crazy8PublicPlayer {
  seat: Crazy8Seat;
  name: string;
  avatar: string;
  connected: boolean;
  isHost: boolean;
  isBot: boolean;
  /** How many cards this player holds — a count only, never the cards. */
  cardCount: number;
}

/** Shared table state broadcast to every client. Contains no private hands. */
export interface Crazy8PublicRoomState {
  roomCode: string;
  phase: 'waiting' | 'playing' | 'roundEnd' | 'gameOver';
  /** The host's originally targeted seat count (2–4), shown while waiting. */
  tableSize: number;
  /** The actual number of seats in play once the match has started. */
  numPlayers: number;
  players: Crazy8PublicPlayer[];
  seatsFilled: number;
  roundNumber: number;
  /** Seat whose turn it is, or null when nobody is on the clock. */
  turn: Crazy8Seat | null;
  /** The literal face-up top card of the discard pile. */
  topCard: Crazy8Card | null;
  /** The currently required suit — may differ from `topCard`'s own suit. */
  requiredSuit: Crazy8Suit | null;
  drawPileCount: number;
  /** Cumulative score per seat, plain whole points (lower is better). */
  scores: number[];
  hostPlayerId: string;
  /** True once the host may use "Start now" (>=2 real players, not yet started). */
  canStartNow: boolean;
  /**
   * Every completed round so far this match, oldest first — powers the Scores
   * panel's round-by-round history table. (Sent in full on every update rather
   * than accumulated client-side, so it survives a refresh/reconnect.)
   */
  roundHistory: Crazy8RoundResultPayload[];
}

/** The personalized slice sent only to its owner — the ONLY carrier of cards. */
export interface Crazy8SelfState {
  playerId: string;
  seat: Crazy8Seat;
  /** This recipient's own hand. Never includes anyone else's cards. */
  hand: Crazy8Card[];
  /** Cards currently legal to play — empty (on your turn) means you must draw. */
  legalPlays: Crazy8Card[];
}

/** Payload of every `crazy8_room_state_update`. */
export interface Crazy8RoomStateUpdate {
  room: Crazy8PublicRoomState;
  self: Crazy8SelfState | null;
}

export interface Crazy8RoundResultPayload {
  roundNumber: number;
  winnerSeat: Crazy8Seat;
  pointsThisRound: number[];
  cumulativeScores: number[];
  playerNames: string[];
  isBot: boolean[];
}

export interface Crazy8FinalStanding {
  seat: Crazy8Seat;
  playerId: string;
  name: string;
  isBot: boolean;
  total: number;
  /** 1-based placement; LOWEST total is 1st. Tied totals share a rank. */
  rank: number;
}

export interface Crazy8GameOverPayload {
  standings: Crazy8FinalStanding[];
  rounds: Crazy8RoundResultPayload[];
}

/* ── Client → Server request/ack payloads ─────────────────────────────────── */

export interface Crazy8CreateRoomReq {
  /** How many total seats the host is targeting (2–4). */
  tableSize: 2 | 3 | 4;
  /** 'bots' fills every non-host seat immediately. 'teammates' waits for real
   * players, backfilling any still-empty seats with bots once ready. */
  mode: 'bots' | 'teammates';
  /** For 'teammates' mode: how many real teammates to wait for (1..tableSize-1). */
  teammates?: number;
}
export interface Crazy8CreateRoomRes {
  ok: boolean;
  roomCode?: string;
  error?: string;
}

export interface Crazy8JoinRoomReq {
  roomCode: string;
}
export interface Crazy8JoinRoomRes {
  ok: boolean;
  seat?: Crazy8Seat;
  error?: string;
}

export interface Crazy8PlayCardReq {
  card: Crazy8Card;
  /** Required when `card.rank === 8` — the suit to declare as required next. */
  declaredSuit?: Crazy8Suit;
}
export interface Crazy8PlayAgainRes {
  ok: boolean;
  roomCode?: string;
  error?: string;
}

/* ── History persistence record ────────────────────────────────────────────── */

export interface Crazy8MatchPlayerRecord {
  playerId: string;
  name: string;
  seat: Crazy8Seat;
  total: number;
  rank: number;
}

export interface Crazy8MatchRecord {
  id?: string;
  gameType: 'crazy8s';
  roomCode: string;
  playedAt: string;
  players: Crazy8MatchPlayerRecord[];
  rounds: Crazy8RoundResultPayload[];
}

/* ── Event name constants ──────────────────────────────────────────────────── */

export const Crazy8ClientEvents = {
  CreateRoom: 'crazy8_create_room',
  JoinRoom: 'crazy8_join_room',
  PlayCard: 'crazy8_play_card',
  DrawCards: 'crazy8_draw_cards',
  StartNow: 'crazy8_start_now',
  LeaveRoom: 'crazy8_leave_room',
  PlayAgain: 'crazy8_play_again',
} as const;

export const Crazy8ServerEvents = {
  RoomStateUpdate: 'crazy8_room_state_update',
  RoundResult: 'crazy8_round_result',
  GameOver: 'crazy8_game_over',
  ErrorMessage: 'crazy8_error_message',
  PlayAgainRoom: 'crazy8_play_again_room',
} as const;

// Re-export the Crazy8 card-kernel types/helpers the UI needs from one place.
export type { Card as Crazy8Card, Seat as Crazy8Seat, Suit as Crazy8Suit } from '@cardadda/crazy8-engine';
export { WILD_RANK as CRAZY8_WILD_RANK } from '@cardadda/crazy8-engine';
