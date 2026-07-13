import type { Server, Socket } from 'socket.io';
import {
  BOT_TABLE_SIZE,
  RuleViolation,
  buildRanking,
  createGame,
  evaluateSeatHand,
  fold,
  placeBet,
  requestShow,
  requestSideShow,
  respondToSideShow,
  seeCards,
  type Seat,
} from '@cardadda/teenpatti-engine';
import {
  TeenPattiClientEvents,
  TeenPattiServerEvents,
  type TeenPattiBetReq,
  type TeenPattiCreateRoomReq,
  type TeenPattiCreateRoomRes,
  type TeenPattiFinalStanding,
  type TeenPattiGameOverPayload,
  type TeenPattiHandResultPayload,
  type TeenPattiJoinRoomReq,
  type TeenPattiJoinRoomRes,
  type TeenPattiMatchRecord,
  type TeenPattiPlayAgainRes,
  type TeenPattiSideShowResReq,
} from '@cardadda/shared';
import { config } from './config';
import { generateUniqueRoomCode } from './codes';
import { avatarForSeat } from './avatars';
import { MatchHistoryStore } from './persistence';
import { log } from './logger';
import { chooseAction, chooseSideShowResponse } from './teenPattiBotAI';
import { TeenPattiRoom, TeenPattiRoomPlayer } from './teenPattiRoom';
import { buildPublicRoomState, buildSelfState } from './teenPattiRedact';

function botDelayMs(): number {
  return 800 + Math.floor(Math.random() * 700);
}

interface SocketData {
  userId?: string;
  username?: string;
  teenPattiRoomCode?: string;
}

type Ack<T> = ((res: T) => void) | undefined;

export class TeenPattiGameServer {
  private rooms = new Map<string, TeenPattiRoom>();

  constructor(
    private readonly io: Server,
    private readonly history: MatchHistoryStore,
  ) {}

  register(socket: Socket): void {
    socket.on(TeenPattiClientEvents.CreateRoom, (req: TeenPattiCreateRoomReq, ack: Ack<TeenPattiCreateRoomRes>) =>
      this.guard(() => this.onCreateRoom(socket, req, ack), () => ack?.({ ok: false, error: 'Server error' })),
    );
    socket.on(TeenPattiClientEvents.JoinRoom, (req: TeenPattiJoinRoomReq, ack: Ack<TeenPattiJoinRoomRes>) =>
      this.guard(() => this.onJoinRoom(socket, req, ack), () => ack?.({ ok: false, error: 'Server error' })),
    );
    socket.on(TeenPattiClientEvents.StartNow, () => this.guard(() => this.onStartNow(socket)));
    socket.on(TeenPattiClientEvents.SeeCards, () => this.guard(() => this.onSeeCards(socket)));
    socket.on(TeenPattiClientEvents.Bet, (req: TeenPattiBetReq) => this.guard(() => this.onBet(socket, req)));
    socket.on(TeenPattiClientEvents.Fold, () => this.guard(() => this.onFold(socket)));
    socket.on(TeenPattiClientEvents.RequestShow, () => this.guard(() => this.onRequestShow(socket)));
    socket.on(TeenPattiClientEvents.RequestSideShow, () => this.guard(() => this.onRequestSideShow(socket)));
    socket.on(TeenPattiClientEvents.RespondSideShow, (req: TeenPattiSideShowResReq) =>
      this.guard(() => this.onRespondSideShow(socket, req)),
    );
    socket.on(TeenPattiClientEvents.LeaveRoom, () => this.guard(() => this.onLeaveRoom(socket)));
    socket.on(TeenPattiClientEvents.PlayAgain, (ack: Ack<TeenPattiPlayAgainRes>) =>
      this.guard(() => this.onPlayAgain(socket, ack), () => ack?.({ ok: false, error: 'Server error' })),
    );
    socket.on('disconnect', () => this.guard(() => this.onDisconnect(socket)));
  }

  roomSummary(code: string): { exists: boolean; seatsFilled: number; phase: string } {
    const room = this.rooms.get(code.toUpperCase());
    return room ? { exists: true, seatsFilled: room.seatsFilled, phase: room.phase } : { exists: false, seatsFilled: 0, phase: 'none' };
  }

  private onCreateRoom(socket: Socket, req: TeenPattiCreateRoomReq, ack: Ack<TeenPattiCreateRoomRes>): void {
    const identity = this.identityOf(socket);
    if (!identity) return ack?.({ ok: false, error: 'Not authenticated' });
    const { userId, username } = identity;

    const fillMode = req?.mode === 'teammates' ? 'teammates' : 'bots';
    const variant = req?.variant ?? 'classic';
    const code = generateUniqueRoomCode((c) => this.rooms.has(c));
    const room = new TeenPattiRoom(code, userId, variant, fillMode);
    this.rooms.set(code, room);

    room.players.push({
      playerId: userId,
      name: username,
      seat: 0 as Seat,
      avatar: avatarForSeat(0),
      connected: true,
      isBot: false,
      socketId: socket.id,
      disconnectTimer: null,
    });
    this.bindSocket(socket, code);

    ack?.({ ok: true, roomCode: code });
    log.info(`Teen Patti room ${code} created by ${username} (${variant}, ${fillMode})`);

    this.maybeStart(room);
    this.broadcastRoom(room);
    this.driveBots(room);
  }

  private onJoinRoom(socket: Socket, req: TeenPattiJoinRoomReq, ack: Ack<TeenPattiJoinRoomRes>): void {
    const identity = this.identityOf(socket);
    if (!identity) return ack?.({ ok: false, error: 'Not authenticated' });
    const { userId, username } = identity;
    const roomCode = String(req?.roomCode ?? '').trim().toUpperCase();

    const room = this.rooms.get(roomCode);
    if (!room) return ack?.({ ok: false, error: 'Room not found' });

    const existing = room.playerById(userId);
    if (existing) {
      if (existing.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = null;
      }
      existing.connected = true;
      existing.socketId = socket.id;
      existing.name = username;
      this.bindSocket(socket, roomCode);
      ack?.({ ok: true, seat: existing.seat });
      this.maybeStart(room);
      this.broadcastRoom(room);
      this.driveBots(room);
      return;
    }

    if (room.game) return ack?.({ ok: false, error: 'Game already in progress' });
    const seat = room.nextFreeSeat();
    if (seat === null) return ack?.({ ok: false, error: 'Room is full' });

    room.players.push({
      playerId: userId,
      name: username,
      seat,
      avatar: avatarForSeat(seat),
      connected: true,
      isBot: false,
      socketId: socket.id,
      disconnectTimer: null,
    });
    this.bindSocket(socket, roomCode);
    ack?.({ ok: true, seat });

    this.broadcastRoom(room);
  }

  private onStartNow(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.playerId !== room.hostPlayerId) return this.emitError(socket, 'Only the host can start the table');
    if (!room.canStartNow()) return this.emitError(socket, 'Need at least 2 real players to start');
    room.compactSeats();
    room.game = createGame(room.players.length, room.variant, Math.random);
    this.broadcastRoom(room);
    this.driveBots(room);
  }

  private onSeeCards(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    try {
      room.game = seeCards(room.game, player.seat);
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    this.broadcastRoom(room);
    this.driveBots(room);
  }

  private onBet(socket: Socket, req: TeenPattiBetReq): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    try {
      room.game = placeBet(room.game, player.seat, Number(req?.amount));
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    this.settle(room);
  }

  private onFold(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    try {
      room.game = fold(room.game, player.seat);
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    this.settle(room);
  }

  private onRequestShow(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    try {
      room.game = requestShow(room.game, player.seat);
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    this.settle(room);
  }

  private onRequestSideShow(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    try {
      room.game = requestSideShow(room.game, player.seat);
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    this.broadcastRoom(room);
    this.driveBots(room);
  }

  private onRespondSideShow(socket: Socket, req: TeenPattiSideShowResReq): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    try {
      room.game = respondToSideShow(room.game, player.seat, Boolean(req?.accept));
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    this.settle(room);
  }

  private onLeaveRoom(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    this.removePlayer(ctx.room, ctx.player);
  }

  private onPlayAgain(socket: Socket, ack: Ack<TeenPattiPlayAgainRes>): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return ack?.({ ok: false, error: 'Not in a room' });
    const { room } = ctx;

    const survivors = room.players
      .filter((p) => !p.isBot && p.connected)
      .sort((a, b) => a.seat - b.seat);
    if (room.fillMode === 'teammates' && survivors.length < 2) {
      return ack?.({ ok: false, error: 'Need at least 2 players to continue' });
    }
    if (survivors.length === 0) return ack?.({ ok: false, error: 'No players to continue' });

    const newCode = generateUniqueRoomCode((c) => this.rooms.has(c));
    const host = survivors.find((p) => p.playerId === room.hostPlayerId)?.playerId ?? survivors[0]!.playerId;
    const newRoom = new TeenPattiRoom(newCode, host, room.variant, room.fillMode);

    survivors.forEach((p, i) => {
      newRoom.players.push({
        playerId: p.playerId,
        name: p.name,
        seat: i as Seat,
        avatar: avatarForSeat(i),
        connected: false,
        isBot: false,
        socketId: null,
        disconnectTimer: null,
      });
    });
    this.rooms.set(newCode, newRoom);

    for (const p of survivors) {
      if (p.socketId) this.io.to(p.socketId).emit(TeenPattiServerEvents.PlayAgainRoom, { roomCode: newCode });
    }
    ack?.({ ok: true, roomCode: newCode });
    this.destroyRoom(room);
  }

  private onDisconnect(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    player.connected = false;
    player.socketId = null;
    this.broadcastRoom(room);

    player.disconnectTimer = setTimeout(() => {
      player.disconnectTimer = null;
      if (!player.connected) this.removePlayer(room, player);
    }, config.reconnectGraceMs);
  }

  private maybeStart(room: TeenPattiRoom): void {
    if (!room.readyToAutoStart()) return;
    room.compactSeats();
    let seat = room.nextFreeSeat();
    while (seat !== null && room.players.length < BOT_TABLE_SIZE) {
      room.players.push({
        playerId: `bot-${seat}`,
        name: 'Bot',
        seat,
        avatar: avatarForSeat(seat),
        connected: true,
        isBot: true,
        socketId: null,
        disconnectTimer: null,
      });
      seat = room.nextFreeSeat();
    }
    room.game = createGame(BOT_TABLE_SIZE, room.variant, Math.random);
  }

  private settle(room: TeenPattiRoom): void {
    this.broadcastRoom(room);
    if (!room.game) return;
    if (room.game.phase === 'gameOver') {
      this.handleGameOver(room);
      return;
    }
    this.driveBots(room);
  }

  private driveBots(room: TeenPattiRoom): void {
    const game = room.game;
    if (!game) return;

    if (game.phase === 'sideShow' && game.pendingSideShow) {
      const player = room.playerBySeat(game.pendingSideShow.target);
      if (player?.isBot && !room.botTimers.has(player.seat)) {
        this.scheduleBot(room, player.seat, () => {
          if (!room.game || room.game.phase !== 'sideShow' || room.game.pendingSideShow?.target !== player.seat) return;
          room.game = respondToSideShow(room.game, player.seat, chooseSideShowResponse(room.game, player.seat));
          this.settle(room);
        });
      }
      return;
    }

    if (game.phase !== 'playing' || game.turn === null) return;
    const player = room.playerBySeat(game.turn);
    if (player?.isBot && !room.botTimers.has(player.seat)) {
      this.scheduleBot(room, player.seat, () => {
        if (!room.game || room.game.phase !== 'playing' || room.game.turn !== player.seat) return;
        try {
          const action = chooseAction(room.game, player.seat);
          switch (action.action) {
            case 'see':
              room.game = seeCards(room.game, player.seat);
              this.broadcastRoom(room);
              this.driveBots(room);
              return;
            case 'fold':
              room.game = fold(room.game, player.seat);
              break;
            case 'show':
              room.game = requestShow(room.game, player.seat);
              break;
            case 'sideShow':
              room.game = requestSideShow(room.game, player.seat);
              this.broadcastRoom(room);
              this.driveBots(room);
              return;
            case 'bet':
              room.game = placeBet(room.game, player.seat, action.amount);
              break;
          }
        } catch (err) {
          log.error(`Teen Patti bot action failed (seat ${player.seat})`, err);
          room.game = fold(room.game!, player.seat);
        }
        this.settle(room);
      });
    }
  }

  private scheduleBot(room: TeenPattiRoom, seat: Seat, fn: () => void): void {
    const timer = setTimeout(() => {
      room.botTimers.delete(seat);
      fn();
    }, botDelayMs());
    room.botTimers.set(seat, timer);
  }

  private handleGameOver(room: TeenPattiRoom): void {
    const game = room.game;
    if (!game || game.winner === null) return;

    const standings = this.buildStandings(room);
    const result: TeenPattiHandResultPayload = {
      winnerSeat: game.winner,
      pot: game.pot,
      variant: room.variant,
      jokerRank: game.jokerRank,
      revealedHands: room.players
        .slice()
        .sort((a, b) => a.seat - b.seat)
        .map((p) => game.hands[p.seat]!.slice()),
      handLabels: room.players
        .slice()
        .sort((a, b) => a.seat - b.seat)
        .map((p) => evaluateSeatHand(game, p.seat).label),
      playerNames: room.players
        .slice()
        .sort((a, b) => a.seat - b.seat)
        .map((p) => p.name),
      isBot: room.players
        .slice()
        .sort((a, b) => a.seat - b.seat)
        .map((p) => p.isBot),
      showdown: game.showdown
        ? {
            kind: game.showdown.kind,
            requester: game.showdown.requester,
            target: game.showdown.target,
            winner: game.showdown.winner,
            loser: game.showdown.loser,
            tie: game.showdown.tie,
          }
        : null,
    };

    const payload: TeenPattiGameOverPayload = { standings, result };
    this.broadcastToRoom(room, TeenPattiServerEvents.GameOver, payload);

    const record: TeenPattiMatchRecord = {
      gameType: 'teenpatti',
      roomCode: room.code,
      playedAt: new Date().toISOString(),
      players: standings.map((s) => ({
        playerId: s.playerId,
        name: s.name,
        seat: s.seat,
        rank: s.rank,
        status: s.status,
      })),
      rounds: [result],
    };
    this.history.saveMatch(record).catch((err) => log.error('Failed to save Teen Patti match history', err));
  }

  private buildStandings(room: TeenPattiRoom): TeenPattiFinalStanding[] {
    const game = room.game!;
    return buildRanking(game).map((seat, index) => {
      const player = room.playerBySeat(seat);
      return {
        seat,
        playerId: player?.playerId ?? '',
        name: player?.name ?? `Seat ${seat}`,
        isBot: player?.isBot ?? false,
        rank: index + 1,
        status: index === 0 ? 'winner' : 'folded',
      };
    });
  }

  private removePlayer(room: TeenPattiRoom, player: TeenPattiRoomPlayer): void {
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    room.players = room.players.filter((p) => p !== player);

    if (room.players.length === 0 || room.players.every((p) => p.isBot)) {
      this.destroyRoom(room);
      return;
    }

    if (room.game && room.game.phase !== 'gameOver') {
      this.broadcastToRoom(room, TeenPattiServerEvents.ErrorMessage, {
        message: 'A player left the table — the hand has ended.',
      });
      this.destroyRoom(room);
      return;
    }

    this.broadcastRoom(room);
  }

  private destroyRoom(room: TeenPattiRoom): void {
    for (const timer of room.botTimers.values()) clearTimeout(timer);
    room.botTimers.clear();
    for (const p of room.players) {
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    }
    this.rooms.delete(room.code);
  }

  private broadcastRoom(room: TeenPattiRoom): void {
    const publicState = buildPublicRoomState(room);
    for (const p of room.players) {
      if (!p.socketId) continue;
      this.io.to(p.socketId).emit(TeenPattiServerEvents.RoomStateUpdate, {
        room: publicState,
        self: buildSelfState(room, p),
      });
    }
  }

  private broadcastToRoom(room: TeenPattiRoom, event: string, payload: unknown): void {
    for (const p of room.players) {
      if (p.socketId) this.io.to(p.socketId).emit(event, payload);
    }
  }

  private bindSocket(socket: Socket, roomCode: string): void {
    (socket.data as SocketData).teenPattiRoomCode = roomCode;
  }

  private identityOf(socket: Socket): { userId: string; username: string } | null {
    const data = socket.data as SocketData;
    if (!data.userId || !data.username) return null;
    return { userId: data.userId, username: data.username };
  }

  private contextOf(socket: Socket): { room: TeenPattiRoom; player: TeenPattiRoomPlayer } | null {
    const data = socket.data as SocketData;
    if (!data.teenPattiRoomCode || !data.userId) return null;
    const room = this.rooms.get(data.teenPattiRoomCode);
    if (!room) return null;
    const player = room.playerById(data.userId);
    if (!player) return null;
    return { room, player };
  }

  private emitError(socket: Socket, message: string): void {
    socket.emit(TeenPattiServerEvents.ErrorMessage, { message });
  }

  private emitRuleError(socket: Socket, err: unknown): void {
    const message = err instanceof RuleViolation ? err.message : 'Invalid move';
    this.emitError(socket, message);
  }

  private guard(fn: () => void, onError?: () => void): void {
    try {
      fn();
    } catch (err) {
      log.error('Unhandled Teen Patti handler error', err);
      onError?.();
    }
  }
}
