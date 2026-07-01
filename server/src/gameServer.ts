/**
 * GameServer — owns the room registry and wires Socket.io events to the pure
 * engine. It never trusts client-supplied state: seats come from the server's
 * own player record, and every mutation goes through the engine's validators.
 *
 * Broadcast model: each connected socket receives a PERSONALIZED
 * `room_state_update` containing the shared public state plus only that
 * player's own hand (see redact.ts). No other player's cards ever leave here.
 */

import type { Server, Socket } from 'socket.io';
import {
  Card,
  RuleViolation,
  Seat,
  createGame,
  placeBid,
  playCard,
  rankSeats,
  startNextRound,
} from '@cardadda/engine';
import {
  ClientEvents,
  ServerEvents,
  type CreateRoomReq,
  type CreateRoomRes,
  type FinalStanding,
  type GameOverPayload,
  type JoinRoomReq,
  type JoinRoomRes,
  type MatchRecord,
  type PlaceBidReq,
  type PlayAgainRes,
  type PlayCardReq,
  type RoundResultPayload,
} from '@cardadda/shared';
import { config } from './config';
import { generateUniqueRoomCode } from './codes';
import { avatarForSeat, sanitizeName } from './avatars';
import { buildPublicRoomState, buildSelfState } from './redact';
import { Room, RoomPlayer } from './room';
import { MatchHistoryStore } from './persistence';
import { log } from './logger';

/** Extra fields we stash on each socket to route later events / disconnects. */
interface SocketData {
  roomCode?: string;
  playerId?: string;
}

type Ack<T> = ((res: T) => void) | undefined;

export class GameServer {
  private rooms = new Map<string, Room>();

  constructor(
    private readonly io: Server,
    private readonly history: MatchHistoryStore,
  ) {}

  /** Attach handlers for a freshly connected socket. */
  register(socket: Socket): void {
    socket.on(ClientEvents.CreateRoom, (req: CreateRoomReq, ack: Ack<CreateRoomRes>) =>
      this.guard(() => this.onCreateRoom(socket, req, ack), () => ack?.({ ok: false, error: 'Server error' })),
    );
    socket.on(ClientEvents.JoinRoom, (req: JoinRoomReq, ack: Ack<JoinRoomRes>) =>
      this.guard(() => this.onJoinRoom(socket, req, ack), () => ack?.({ ok: false, error: 'Server error' })),
    );
    socket.on(ClientEvents.PlaceBid, (req: PlaceBidReq) =>
      this.guard(() => this.onPlaceBid(socket, req)),
    );
    socket.on(ClientEvents.PlayCard, (req: PlayCardReq) =>
      this.guard(() => this.onPlayCard(socket, req)),
    );
    socket.on(ClientEvents.LeaveRoom, () => this.guard(() => this.onLeaveRoom(socket)));
    socket.on(ClientEvents.PlayAgain, (ack: Ack<PlayAgainRes>) =>
      this.guard(() => this.onPlayAgain(socket, ack), () => ack?.({ ok: false, error: 'Server error' })),
    );
    socket.on('disconnect', () => this.guard(() => this.onDisconnect(socket)));
  }

  /* ── HTTP-facing helper (used by the /api/history route) ────────────────── */

  listMatches(playerId: string, limit = 25): Promise<MatchRecord[]> {
    return this.history.listMatchesForPlayer(playerId, limit);
  }

  roomSummary(code: string): { exists: boolean; seatsFilled: number; phase: string } {
    const room = this.rooms.get(code.toUpperCase());
    return room
      ? { exists: true, seatsFilled: room.seatsFilled, phase: room.phase }
      : { exists: false, seatsFilled: 0, phase: 'none' };
  }

  /* ── Handlers ───────────────────────────────────────────────────────────── */

  private onCreateRoom(socket: Socket, req: CreateRoomReq, ack: Ack<CreateRoomRes>): void {
    const playerId = String(req?.playerId ?? '').trim();
    if (!playerId) return ack?.({ ok: false, error: 'Missing player id' });

    const code = generateUniqueRoomCode((c) => this.rooms.has(c));
    const room = new Room(code, playerId);
    this.rooms.set(code, room);

    const seat: Seat = 0;
    room.players.push({
      playerId,
      name: sanitizeName(req.name),
      seat,
      avatar: avatarForSeat(seat),
      connected: true,
      socketId: socket.id,
      disconnectTimer: null,
    });
    this.bindSocket(socket, code, playerId);

    log.info(`Room ${code} created by ${playerId}`);
    ack?.({ ok: true, roomCode: code });
    this.broadcastRoom(room);
  }

  private onJoinRoom(socket: Socket, req: JoinRoomReq, ack: Ack<JoinRoomRes>): void {
    const roomCode = String(req?.roomCode ?? '').trim().toUpperCase();
    const playerId = String(req?.playerId ?? '').trim();
    if (!playerId) return ack?.({ ok: false, error: 'Missing player id' });

    const room = this.rooms.get(roomCode);
    if (!room) return ack?.({ ok: false, error: 'Room not found' });

    // Reconnection / re-entry: a known player id reclaims its held seat.
    const existing = room.playerById(playerId);
    if (existing) {
      if (existing.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = null;
      }
      existing.connected = true;
      existing.socketId = socket.id;
      existing.name = sanitizeName(req.name);
      this.bindSocket(socket, roomCode, playerId);
      ack?.({ ok: true, seat: existing.seat });
      log.info(`Player ${playerId} reconnected to ${roomCode} (seat ${existing.seat})`);
      this.startIfReady(room);
      this.broadcastRoom(room);
      return;
    }

    // New player joining a still-open table.
    if (room.game) return ack?.({ ok: false, error: 'Game already in progress' });
    const seat = room.nextFreeSeat();
    if (seat === null) return ack?.({ ok: false, error: 'Room is full' });

    room.players.push({
      playerId,
      name: sanitizeName(req.name),
      seat,
      avatar: avatarForSeat(seat),
      connected: true,
      socketId: socket.id,
      disconnectTimer: null,
    });
    this.bindSocket(socket, roomCode, playerId);
    ack?.({ ok: true, seat });
    log.info(`Player ${playerId} joined ${roomCode} (seat ${seat})`);

    // Auto-start once the table is full and everyone is connected.
    this.startIfReady(room);
    this.broadcastRoom(room);
  }

  private onPlaceBid(socket: Socket, req: PlaceBidReq): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    try {
      room.game = placeBid(room.game, player.seat, Number(req?.bid));
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    this.broadcastRoom(room);
  }

  private onPlayCard(socket: Socket, req: PlayCardReq): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');

    const card = req?.card as Card;
    const prevHistoryLen = room.game.history.length;
    try {
      room.game = playCard(room.game, player.seat, card);
    } catch (err) {
      return this.emitRuleError(socket, err);
    }

    const game = room.game;
    this.broadcastRoom(room);

    // A completed round appended a history entry — surface the round result.
    if (game.history.length > prevHistoryLen) {
      this.emitRoundResult(room);
    }

    if (game.phase === 'gameOver') {
      this.handleGameOver(room);
    } else if (game.phase === 'roundEnd') {
      this.scheduleNextRound(room);
    }
  }

  private onLeaveRoom(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    // An explicit leave removes the player immediately (no grace window).
    this.removePlayer(ctx.room, ctx.player);
  }

  private onPlayAgain(socket: Socket, ack: Ack<PlayAgainRes>): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return ack?.({ ok: false, error: 'Not in a room' });
    const { room } = ctx;

    const survivors = room.connectedPlayers().sort((a, b) => a.seat - b.seat);
    if (survivors.length === 0) return ack?.({ ok: false, error: 'No players to continue' });

    const newCode = generateUniqueRoomCode((c) => this.rooms.has(c));
    // Preserve the original host if they're still here; else the lowest seat.
    const host =
      survivors.find((p) => p.playerId === room.hostPlayerId)?.playerId ?? survivors[0]!.playerId;
    const newRoom = new Room(newCode, host);

    // Pre-seat the survivors (disconnected until their client rejoins the new room).
    survivors.forEach((p, i) => {
      const seat = i as Seat;
      newRoom.players.push({
        playerId: p.playerId,
        name: p.name,
        seat,
        avatar: avatarForSeat(seat),
        connected: false,
        socketId: null,
        disconnectTimer: null,
      });
    });
    this.rooms.set(newCode, newRoom);

    // Tell every survivor to move to the new room; their client will rejoin.
    for (const p of survivors) {
      if (p.socketId) this.io.to(p.socketId).emit(ServerEvents.PlayAgainRoom, { roomCode: newCode });
    }
    ack?.({ ok: true, roomCode: newCode });
    log.info(`Play again: ${room.code} → ${newCode} with ${survivors.length} players`);

    // Retire the old room.
    this.destroyRoom(room);
  }

  private onDisconnect(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;

    player.connected = false;
    player.socketId = null;
    log.info(`Player ${player.playerId} dropped from ${room.code}; holding seat ${player.seat}`);
    this.broadcastRoom(room);

    // Hold the seat for the grace window, then remove if still absent.
    player.disconnectTimer = setTimeout(() => {
      player.disconnectTimer = null;
      if (!player.connected) {
        log.info(`Grace expired for ${player.playerId} in ${room.code}; removing`);
        this.removePlayer(room, player);
      }
    }, config.reconnectGraceMs);
  }

  /* ── Lifecycle helpers ──────────────────────────────────────────────────── */

  /** Deal and begin the match when the table is full and everyone's present. */
  private startIfReady(room: Room): void {
    if (!room.isReadyToStart()) return;
    // Host (seat 0) deals the first round; the engine rotates thereafter.
    room.game = createGame(Math.random, 0);
    log.info(`Room ${room.code} is full — starting match`);
  }

  private scheduleNextRound(room: Room): void {
    if (room.roundEndTimer) clearTimeout(room.roundEndTimer);
    room.roundEndTimer = setTimeout(() => {
      room.roundEndTimer = null;
      if (!room.game || room.game.phase !== 'roundEnd') return;
      room.game = startNextRound(room.game, Math.random);
      this.broadcastRoom(room);
    }, config.roundEndDelayMs);
  }

  private handleGameOver(room: Room): void {
    const game = room.game;
    if (!game) return;
    const standings = this.buildStandings(room);
    const rounds = room.game!.history.map((r) => this.toRoundResultPayload(room, r.roundNumber, r));

    const payload: GameOverPayload = { standings, rounds };
    this.broadcastToRoom(room, ServerEvents.GameOver, payload);
    log.info(`Room ${room.code} game over`);

    // Persist match history (fire-and-forget; never blocks gameplay).
    const record: MatchRecord = {
      roomCode: room.code,
      playedAt: new Date().toISOString(),
      players: standings.map((s) => ({
        playerId: s.playerId,
        name: s.name,
        seat: s.seat,
        totalTenths: s.totalTenths,
        rank: s.rank,
      })),
      rounds,
    };
    this.history.saveMatch(record).catch((err) => log.error('Failed to save match history', err));
  }

  private buildStandings(room: Room): FinalStanding[] {
    const game = room.game!;
    const ranked = rankSeats(game.scores);
    return ranked.map((r) => {
      const player = room.playerBySeat(r.seat);
      return {
        seat: r.seat,
        playerId: player?.playerId ?? '',
        name: player?.name ?? `Seat ${r.seat}`,
        totalTenths: r.totalTenths,
        rank: r.rank,
      };
    });
  }

  private emitRoundResult(room: Room): void {
    const game = room.game!;
    const last = game.history[game.history.length - 1]!;
    const payload = this.toRoundResultPayload(room, last.roundNumber, last);
    this.broadcastToRoom(room, ServerEvents.RoundResult, payload);
  }

  private toRoundResultPayload(
    room: Room,
    roundNumber: number,
    r: { bids: readonly number[]; tricksWon: readonly number[]; scoreTenths: readonly number[]; cumulativeTenths: readonly number[] },
  ): RoundResultPayload {
    const playerNames = [0, 1, 2, 3].map((seat) => room.playerBySeat(seat as Seat)?.name ?? `Seat ${seat}`);
    return {
      roundNumber,
      bids: [...r.bids],
      tricksWon: [...r.tricksWon],
      scoreTenths: [...r.scoreTenths],
      cumulativeTenths: [...r.cumulativeTenths],
      playerNames,
    };
  }

  /** Remove a player; free their seat, or abort/close the room as appropriate. */
  private removePlayer(room: Room, player: RoomPlayer): void {
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    room.players = room.players.filter((p) => p !== player);

    if (room.players.length === 0) {
      this.destroyRoom(room);
      return;
    }

    // Losing a seat mid-match can't continue fairly → abort and retire the room.
    if (room.game && room.game.phase !== 'gameOver') {
      this.broadcastToRoom(
        room,
        ServerEvents.ErrorMessage,
        { message: 'A player left the table — the match has ended.' },
      );
      this.destroyRoom(room);
      return;
    }

    // Otherwise (still waiting, or already game over) just reflect the change.
    this.broadcastRoom(room);
  }

  private destroyRoom(room: Room): void {
    if (room.roundEndTimer) clearTimeout(room.roundEndTimer);
    for (const p of room.players) {
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    }
    this.rooms.delete(room.code);
    log.info(`Room ${room.code} destroyed`);
  }

  /* ── Broadcast & utility ────────────────────────────────────────────────── */

  /**
   * Send every connected player their personalized state. This is where the
   * privacy guarantee is enforced: each socket gets only its own `self.hand`.
   */
  private broadcastRoom(room: Room): void {
    const publicState = buildPublicRoomState(room);
    for (const p of room.players) {
      if (!p.socketId) continue;
      const self = buildSelfState(room, p);
      this.io.to(p.socketId).emit(ServerEvents.RoomStateUpdate, { room: publicState, self });
    }
  }

  private broadcastToRoom(room: Room, event: string, payload: unknown): void {
    for (const p of room.players) {
      if (p.socketId) this.io.to(p.socketId).emit(event, payload);
    }
  }

  private bindSocket(socket: Socket, roomCode: string, playerId: string): void {
    const data = socket.data as SocketData;
    data.roomCode = roomCode;
    data.playerId = playerId;
  }

  /** Resolve the room + player for a socket, or null if it's not seated. */
  private contextOf(socket: Socket): { room: Room; player: RoomPlayer } | null {
    const data = socket.data as SocketData;
    if (!data.roomCode || !data.playerId) return null;
    const room = this.rooms.get(data.roomCode);
    if (!room) return null;
    const player = room.playerById(data.playerId);
    if (!player) return null;
    return { room, player };
  }

  private emitError(socket: Socket, message: string): void {
    socket.emit(ServerEvents.ErrorMessage, { message });
  }

  private emitRuleError(socket: Socket, err: unknown): void {
    const message = err instanceof RuleViolation ? err.message : 'Invalid move';
    this.emitError(socket, message);
  }

  /** Run a handler, swallowing unexpected errors so one bad event can't crash. */
  private guard(fn: () => void, onError?: () => void): void {
    try {
      fn();
    } catch (err) {
      log.error('Unhandled handler error', err);
      onError?.();
    }
  }
}
