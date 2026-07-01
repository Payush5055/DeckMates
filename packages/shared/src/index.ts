/**
 * @cardadda/shared — the wire contract between the Socket.io server and clients.
 *
 * These types define exactly what crosses the network. The single most important
 * rule of this file: the shapes a CLIENT receives (`PublicRoomState`,
 * `SelfState`) expose other players' card *counts* — never their cards. Only
 * `SelfState.hand` carries actual cards, and it is sent solely to its owner.
 */

import type { Card, Seat, Phase } from '@cardadda/engine';

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
  /** How many cards this player holds — a count only, never the cards. */
  cardCount: number;
  /** This player's bid, once placed (public per the rules). */
  bid: number | null;
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
}

export interface FinalStanding {
  seat: Seat;
  playerId: string;
  name: string;
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
// handshake and verified server-side — clients no longer send it. Creating a
// room therefore needs no payload.
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

export interface MatchRecord {
  id?: string;
  roomCode: string;
  /** ISO 8601 timestamp of when the match finished. */
  playedAt: string;
  players: MatchPlayerRecord[];
  rounds: RoundResultPayload[];
}

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
