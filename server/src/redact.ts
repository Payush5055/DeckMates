/**
 * Redaction: turn authoritative room state into the shapes that go over the
 * wire. This is the single chokepoint enforcing the brief's critical rule —
 * a client must NEVER receive another player's hand.
 *
 *   • `buildPublicRoomState` exposes per-player card COUNTS only.
 *   • `buildSelfState` returns exactly one player's own hand.
 *
 * The server sends each socket `{ room: <public>, self: <their own> }`.
 */

import { NUM_PLAYERS, TOTAL_ROUNDS, legalPlays } from '@cardadda/engine';
import type {
  PublicPlayer,
  PublicRoomState,
  SelfState,
} from '@cardadda/shared';
import { Room, RoomPlayer } from './room';

/** Public table state — safe to send to everyone. Carries no hands. */
export function buildPublicRoomState(room: Room): PublicRoomState {
  const game = room.game;
  // Blind bidding: while still in the bidding phase, no one's bid value is
  // revealed — only whether they've submitted. Values appear once phase→playing.
  const biddingOpen = game !== null && game.phase === 'bidding';
  const players: PublicPlayer[] = [...room.players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({
      seat: p.seat,
      name: p.name,
      avatar: p.avatar,
      connected: p.connected,
      isHost: p.playerId === room.hostPlayerId,
      isBot: p.isBot,
      // Count only — the actual cards are deliberately not included.
      cardCount: game ? game.hands[p.seat]!.length : 0,
      bid: game && !biddingOpen ? game.bids[p.seat]! : null,
      hasBid: game ? game.bids[p.seat] !== null : false,
      tricksWon: game ? game.tricksWon[p.seat]! : 0,
    }));

  // Nobody is "on the clock" during blind bidding (all bid at once) or while a
  // completed trick is held face-up — only during active trick play.
  const trickHeld = game !== null && game.currentTrick.length >= NUM_PLAYERS;
  const onClock = game !== null && game.phase === 'playing' && !trickHeld;

  return {
    roomCode: room.code,
    phase: room.phase,
    players,
    seatsFilled: room.players.length,
    roundNumber: game?.roundNumber ?? 0,
    totalRounds: TOTAL_ROUNDS,
    dealer: game?.dealer ?? null,
    leadSeat: game?.leadSeat ?? null,
    turn: onClock ? game!.turn : null,
    // Cards already played into the trick are face-up on the table → public.
    currentTrick: game ? game.currentTrick.map((t) => ({ seat: t.seat, card: t.card })) : [],
    scores: game ? game.scores.slice() : [0, 0, 0, 0],
    hostPlayerId: room.hostPlayerId,
  };
}

/** The private slice for one recipient — the only payload that holds cards. */
export function buildSelfState(room: Room, player: RoomPlayer): SelfState {
  const game = room.game;
  const hand = game ? game.hands[player.seat]!.slice() : [];

  // Offer legal moves only when it is genuinely this player's turn to play
  // (never while a completed trick is held face-up awaiting resolution).
  let legal: SelfState['legalPlays'] = [];
  if (
    game &&
    game.phase === 'playing' &&
    game.turn === player.seat &&
    game.currentTrick.length < NUM_PLAYERS
  ) {
    legal = legalPlays(hand, game.currentTrick);
  }

  return {
    playerId: player.playerId,
    seat: player.seat,
    hand,
    legalPlays: legal,
    // A player always sees their own bid, even while others' stay blind.
    bid: game ? game.bids[player.seat]! : null,
  };
}
