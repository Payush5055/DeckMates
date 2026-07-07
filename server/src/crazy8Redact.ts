/**
 * Redaction for Crazy 8s: turn authoritative room state into the shapes that
 * go over the wire. Mirrors the Callbreak redaction chokepoint — a client must
 * NEVER receive another player's hand or the draw pile's contents.
 *
 *   • `buildPublicRoomState` exposes per-player card COUNTS only, plus the
 *     face-up top discard card and draw pile count (never its contents).
 *   • `buildSelfState` returns exactly one player's own hand.
 */

import { legalPlays, topCard, type GameState } from '@cardadda/crazy8-engine';
import type {
  Crazy8PublicPlayer,
  Crazy8PublicRoomState,
  Crazy8RoundResultPayload,
  Crazy8SelfState,
} from '@cardadda/shared';
import { Crazy8Room, Crazy8RoomPlayer } from './crazy8Room';

function namesBySeat(room: Crazy8Room, numPlayers: number): string[] {
  return Array.from({ length: numPlayers }, (_, seat) => room.playerBySeat(seat)?.name ?? `Seat ${seat}`);
}

function isBotBySeat(room: Crazy8Room, numPlayers: number): boolean[] {
  return Array.from({ length: numPlayers }, (_, seat) => room.playerBySeat(seat)?.isBot ?? false);
}

export function buildPublicRoomState(room: Crazy8Room): Crazy8PublicRoomState {
  const game: GameState | null = room.game;
  const players: Crazy8PublicPlayer[] = [...room.players]
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
    }));

  // Full round-by-round history, sent in full each time (not accumulated
  // client-side) so the Scores panel survives a refresh/reconnect.
  const roundHistory: Crazy8RoundResultPayload[] = game
    ? game.history.map((r) => ({
        roundNumber: r.roundNumber,
        winnerSeat: r.winnerSeat,
        pointsThisRound: [...r.pointsThisRound],
        cumulativeScores: [...r.cumulativeScores],
        playerNames: namesBySeat(room, game.numPlayers),
        isBot: isBotBySeat(room, game.numPlayers),
      }))
    : [];

  return {
    roomCode: room.code,
    phase: room.phase,
    tableSize: room.tableSize,
    numPlayers: game ? game.numPlayers : room.players.length,
    players,
    seatsFilled: room.players.length,
    roundNumber: game?.roundNumber ?? 0,
    turn: game && game.phase === 'playing' ? game.turn : null,
    // The top discard card is face-up on the table → public. The draw pile's
    // contents are never exposed, only its remaining count.
    topCard: game ? topCard(game) : null,
    requiredSuit: game ? game.requiredSuit : null,
    drawPileCount: game ? game.drawPile.length : 0,
    scores: game ? game.scores.slice() : new Array(room.tableSize).fill(0),
    hostPlayerId: room.hostPlayerId,
    canStartNow: room.canStartNow(),
    roundHistory,
  };
}

/** The private slice for one recipient — the only payload that holds cards. */
export function buildSelfState(room: Crazy8Room, player: Crazy8RoomPlayer): Crazy8SelfState {
  const game = room.game;
  const hand = game ? game.hands[player.seat]!.slice() : [];

  // Offer legal moves only when it is genuinely this player's turn to play.
  // An empty array (on your own turn) is the client's cue to show "Draw".
  let legal: Crazy8SelfState['legalPlays'] = [];
  if (game && game.phase === 'playing' && game.turn === player.seat) {
    legal = legalPlays(hand, topCard(game), game.requiredSuit);
  }

  return {
    playerId: player.playerId,
    seat: player.seat,
    hand,
    legalPlays: legal,
  };
}
