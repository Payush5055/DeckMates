/**
 * Redaction for 31: turn authoritative room state into the wire shapes. Same
 * chokepoint rule as the other games — a client must NEVER receive another
 * player's hand or the draw pile's contents. Hands become public only in the
 * round-result (reveal) payload, which is exactly when the rules reveal them.
 */

import type { GameState } from '@cardadda/thirtyone-engine';
import type {
  ThirtyOnePublicPlayer,
  ThirtyOnePublicRoomState,
  ThirtyOneSelfState,
} from '@cardadda/shared';
import { ThirtyOneRoom, ThirtyOneRoomPlayer } from './thirtyOneRoom';

export function buildPublicRoomState(room: ThirtyOneRoom): ThirtyOnePublicRoomState {
  const game: GameState | null = room.game;
  const players: ThirtyOnePublicPlayer[] = [...room.players]
    .sort((a, b) => a.seat - b.seat)
    .map((p) => ({
      seat: p.seat,
      name: p.name,
      avatar: p.avatar,
      connected: p.connected,
      isHost: p.playerId === room.hostPlayerId,
      isBot: p.isBot,
      lives: game ? game.lives[p.seat]! : 3,
      eliminated: game ? game.lives[p.seat]! <= 0 : false,
      // Count only — the actual cards are deliberately not included.
      cardCount: game ? game.hands[p.seat]!.length : 0,
    }));

  const playing = game !== null && game.phase === 'playing';
  return {
    roomCode: room.code,
    phase: room.phase,
    players,
    seatsFilled: room.players.length,
    roundNumber: game?.roundNumber ?? 0,
    turn: playing ? game!.turn : null,
    stage: playing ? game!.stage : null,
    topDiscard: game && game.discardPile.length > 0 ? game.discardPile[game.discardPile.length - 1]! : null,
    drawPileCount: game ? game.drawPile.length : 0,
    knockerSeat: game ? game.knocker : null,
    finalTurnsRemaining: game ? game.finalTurnsRemaining : null,
    lives: game ? game.lives.slice() : [3, 3, 3, 3],
    hostPlayerId: room.hostPlayerId,
  };
}

/** The private slice for one recipient — the only payload that holds cards. */
export function buildSelfState(room: ThirtyOneRoom, player: ThirtyOneRoomPlayer): ThirtyOneSelfState {
  const game = room.game;
  const hand = game ? game.hands[player.seat]!.slice() : [];
  const myTurn = game !== null && game.phase === 'playing' && game.turn === player.seat;
  const atDrawStage = myTurn && game!.stage === 'draw';

  return {
    playerId: player.playerId,
    seat: player.seat,
    hand,
    canDraw: atDrawStage,
    canKnock: atDrawStage && game!.knocker === null,
    mustDiscard: myTurn && game!.stage === 'discard',
  };
}
