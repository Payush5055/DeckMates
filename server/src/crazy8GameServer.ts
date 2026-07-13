/**
 * Crazy8GameServer — owns the Crazy 8s room registry and wires Socket.io
 * events to the pure engine. Mirrors GameServer's design (never trusts
 * client-supplied state; every mutation goes through the engine's validators),
 * adapted for variable 2–4 seat tables, the draw-up-to-3 mechanic, and the
 * wild-8 declared-suit flow.
 *
 * Registered alongside GameServer on the SAME authenticated socket — event
 * names are namespaced (`crazy8_*`) so the two games never collide.
 */

import type { Server, Socket } from 'socket.io';
import {
  RuleViolation,
  createGame,
  drawUpToThree,
  playCard,
  rankByLowest,
  startNextRound,
  type Card,
  type GameState,
  type Seat,
  type Suit,
} from '@cardadda/crazy8-engine';
import {
  Crazy8ClientEvents,
  Crazy8ServerEvents,
  type Crazy8CreateRoomReq,
  type Crazy8CreateRoomRes,
  type Crazy8FinalStanding,
  type Crazy8GameOverPayload,
  type Crazy8JoinRoomReq,
  type Crazy8JoinRoomRes,
  type Crazy8MatchRecord,
  type Crazy8PlayAgainRes,
  type Crazy8PlayCardReq,
  type Crazy8RoundResultPayload,
} from '@cardadda/shared';
import { crazy8PayoutDelta } from '@cardadda/economy-engine';
import { config } from './config';
import { generateUniqueRoomCode } from './codes';
import { avatarForSeat } from './avatars';
import { chooseCard, chooseSuit } from './crazy8BotAI';
import { buildPublicRoomState, buildSelfState } from './crazy8Redact';
import { Crazy8Room, Crazy8RoomPlayer } from './crazy8Room';
import { MatchHistoryStore } from './persistence';
import { adjustBalance, WalletStore } from './wallet';
import { log } from './logger';

/** Bots act after a short, human-like pause (same convention as Callbreak). */
function botDelayMs(): number {
  return 800 + Math.floor(Math.random() * 700);
}

interface SocketData {
  userId?: string;
  username?: string;
  crazy8RoomCode?: string;
}

type Ack<T> = ((res: T) => void) | undefined;

export class Crazy8GameServer {
  private rooms = new Map<string, Crazy8Room>();

  constructor(
    private readonly io: Server,
    private readonly history: MatchHistoryStore,
    private readonly wallet: WalletStore,
  ) {}

  register(socket: Socket): void {
    socket.on(Crazy8ClientEvents.CreateRoom, (req: Crazy8CreateRoomReq, ack: Ack<Crazy8CreateRoomRes>) =>
      this.guard(() => this.onCreateRoom(socket, req, ack), () => ack?.({ ok: false, error: 'Server error' })),
    );
    socket.on(Crazy8ClientEvents.JoinRoom, (req: Crazy8JoinRoomReq, ack: Ack<Crazy8JoinRoomRes>) =>
      this.guard(() => this.onJoinRoom(socket, req, ack), () => ack?.({ ok: false, error: 'Server error' })),
    );
    socket.on(Crazy8ClientEvents.StartNow, () => this.guard(() => this.onStartNow(socket)));
    socket.on(Crazy8ClientEvents.PlayCard, (req: Crazy8PlayCardReq) =>
      this.guard(() => this.onPlayCard(socket, req)),
    );
    socket.on(Crazy8ClientEvents.DrawCards, () => this.guard(() => this.onDrawCards(socket)));
    socket.on(Crazy8ClientEvents.LeaveRoom, () => this.guard(() => this.onLeaveRoom(socket)));
    socket.on(Crazy8ClientEvents.PlayAgain, (ack: Ack<Crazy8PlayAgainRes>) =>
      this.guard(() => this.onPlayAgain(socket, ack), () => ack?.({ ok: false, error: 'Server error' })),
    );
    socket.on('disconnect', () => this.guard(() => this.onDisconnect(socket)));
  }

  roomSummary(code: string): { exists: boolean; seatsFilled: number; phase: string } {
    const room = this.rooms.get(code.toUpperCase());
    return room
      ? { exists: true, seatsFilled: room.seatsFilled, phase: room.phase }
      : { exists: false, seatsFilled: 0, phase: 'none' };
  }

  /* ── Handlers ───────────────────────────────────────────────────────────── */

  private onCreateRoom(socket: Socket, req: Crazy8CreateRoomReq, ack: Ack<Crazy8CreateRoomRes>): void {
    const identity = this.identityOf(socket);
    if (!identity) return ack?.({ ok: false, error: 'Not authenticated' });
    const { userId, username } = identity;

    const tableSize = Math.max(2, Math.min(4, Number(req?.tableSize) || 4));
    const code = generateUniqueRoomCode((c) => this.rooms.has(c));
    const room = new Crazy8Room(code, userId, tableSize);

    if (req?.mode === 'bots') {
      room.expectedRealPlayers = 1;
    } else {
      const teammates = Math.max(1, Math.min(tableSize - 1, Number(req?.teammates) || tableSize - 1));
      room.expectedRealPlayers = 1 + teammates;
    }
    this.rooms.set(code, room);

    room.players.push({
      playerId: userId,
      name: username,
      seat: 0,
      avatar: avatarForSeat(0),
      connected: true,
      isBot: false,
      socketId: socket.id,
      disconnectTimer: null,
    });
    this.bindSocket(socket, code);

    log.info(`Crazy8 room ${code} created by ${username} (table ${tableSize}, expects ${room.expectedRealPlayers} real)`);
    ack?.({ ok: true, roomCode: code });
    this.maybeStart(room);
    this.broadcastRoom(room);
    this.driveBots(room);
  }

  private onJoinRoom(socket: Socket, req: Crazy8JoinRoomReq, ack: Ack<Crazy8JoinRoomRes>): void {
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
      log.info(`Player ${username} reconnected to Crazy8 ${roomCode} (seat ${existing.seat})`);
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
    log.info(`Player ${username} joined Crazy8 ${roomCode} (seat ${seat})`);

    this.maybeStart(room);
    this.broadcastRoom(room);
    this.driveBots(room);
  }

  /** Host-only: start immediately with whoever is currently seated (no bot
   * backfill), as long as at least 2 real players are present. */
  private onStartNow(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.playerId !== room.hostPlayerId) {
      return this.emitError(socket, 'Only the host can start the table');
    }
    if (room.game) return;
    if (!room.canStartNow()) {
      return this.emitError(socket, 'Need at least 2 players to start');
    }
    room.compactSeats();
    room.game = createGame(room.players.length, Math.random);
    log.info(`Crazy8 room ${room.code} started early by host with ${room.players.length} players`);
    this.broadcastRoom(room);
    this.driveBots(room);
  }

  private onPlayCard(socket: Socket, req: Crazy8PlayCardReq): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');

    const card = req?.card as Card;
    const declaredSuit = req?.declaredSuit as Suit | undefined;
    let game: GameState;
    try {
      game = playCard(room.game, player.seat, card, declaredSuit);
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    room.game = game;
    this.broadcastRoom(room);
    this.afterPlay(room);
  }

  private onDrawCards(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');

    let game: GameState;
    try {
      game = drawUpToThree(room.game, player.seat);
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    room.game = game;
    this.broadcastRoom(room);
    // If the draw exhausted 3 tries with nothing playable, turn passed — the
    // new seat on the clock may be a bot. If a playable card was found, turn
    // stayed with this player; they'll submit an ordinary play_card next.
    this.driveBots(room);
  }

  private onLeaveRoom(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    this.removePlayer(ctx.room, ctx.player);
  }

  private onPlayAgain(socket: Socket, ack: Ack<Crazy8PlayAgainRes>): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return ack?.({ ok: false, error: 'Not in a room' });
    const { room } = ctx;

    const survivors = room.players
      .filter((p) => !p.isBot && p.connected)
      .sort((a, b) => a.seat - b.seat);
    if (survivors.length === 0) return ack?.({ ok: false, error: 'No players to continue' });

    const newCode = generateUniqueRoomCode((c) => this.rooms.has(c));
    const host =
      survivors.find((p) => p.playerId === room.hostPlayerId)?.playerId ?? survivors[0]!.playerId;
    // Reuse the same table size by default; wait for exactly the returning
    // real players, backfilling any gap with bots (same convention as Callbreak).
    const newRoom = new Crazy8Room(newCode, host, room.tableSize);
    newRoom.expectedRealPlayers = survivors.length;

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
      if (p.socketId) this.io.to(p.socketId).emit(Crazy8ServerEvents.PlayAgainRoom, { roomCode: newCode });
    }
    ack?.({ ok: true, roomCode: newCode });
    log.info(`Crazy8 play again: ${room.code} → ${newCode} with ${survivors.length} players`);
    this.destroyRoom(room);
  }

  private onDisconnect(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;

    player.connected = false;
    player.socketId = null;
    log.info(`Player ${player.playerId} dropped from Crazy8 ${room.code}; holding seat ${player.seat}`);
    this.broadcastRoom(room);

    player.disconnectTimer = setTimeout(() => {
      player.disconnectTimer = null;
      if (!player.connected) {
        log.info(`Grace expired for ${player.playerId} in Crazy8 ${room.code}; removing`);
        this.removePlayer(room, player);
      }
    }, config.reconnectGraceMs);
  }

  /* ── Lifecycle helpers ──────────────────────────────────────────────────── */

  /** After a play, handle round-end/game-over/next-round, or hand off to bots. */
  private afterPlay(room: Crazy8Room): void {
    const game = room.game;
    if (!game) return;

    if (game.phase === 'roundEnd' || game.phase === 'gameOver') {
      this.emitRoundResult(room);
      if (game.phase === 'gameOver') {
        this.handleGameOver(room);
      } else {
        this.scheduleNextRound(room);
      }
      return;
    }
    this.driveBots(room);
  }

  /** Auto-start once enough real players are present: fill remaining seats
   * (up to tableSize) with bots, then deal. */
  private maybeStart(room: Crazy8Room): void {
    if (!room.readyToStart()) return;
    room.compactSeats();
    let seat = room.nextFreeSeat();
    while (seat !== null) {
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
    room.game = createGame(room.players.length, Math.random);
    const bots = room.players.filter((p) => p.isBot).length;
    log.info(`Crazy8 room ${room.code} starting — ${room.players.length - bots} real + ${bots} bots`);
  }

  private scheduleNextRound(room: Crazy8Room): void {
    if (room.roundEndTimer) clearTimeout(room.roundEndTimer);
    room.roundEndTimer = setTimeout(() => {
      room.roundEndTimer = null;
      if (!room.game || room.game.phase !== 'roundEnd') return;
      room.game = startNextRound(room.game, Math.random);
      this.broadcastRoom(room);
      this.driveBots(room);
    }, config.roundEndDelayMs);
  }

  /* ── Bots ───────────────────────────────────────────────────────────────── */

  private driveBots(room: Crazy8Room): void {
    const game = room.game;
    if (!game || game.phase !== 'playing') return;
    const seat = game.turn;
    const player = room.playerBySeat(seat);
    if (player?.isBot && !room.botTimers.has(seat)) {
      this.scheduleBotTurn(room, seat);
    }
  }

  private scheduleBotTurn(room: Crazy8Room, seat: Seat): void {
    const timer = setTimeout(() => {
      room.botTimers.delete(seat);
      const game = room.game;
      if (!game || game.phase !== 'playing' || game.turn !== seat) return;
      this.performBotTurn(room, seat);
    }, botDelayMs());
    room.botTimers.set(seat, timer);
  }

  private performBotTurn(room: Crazy8Room, seat: Seat): void {
    let game = room.game;
    if (!game) return;

    let card = chooseCard(game, seat);
    if (!card) {
      // No legal play: draw up to 3, stopping early if one becomes playable.
      try {
        game = drawUpToThree(game, seat);
      } catch (err) {
        return log.error(`Crazy8 bot draw failed (seat ${seat})`, err);
      }
      room.game = game;
      this.broadcastRoom(room);
      if (game.phase !== 'playing' || game.turn !== seat) {
        // Turn passed (nothing playable after 3 draws) — nothing more to do.
        this.driveBots(room);
        return;
      }
      card = chooseCard(game, seat);
      if (!card) return; // defensive: shouldn't happen if drawUpToThree found a play
    }

    const declaredSuit =
      card.rank === 8
        ? chooseSuit(game.hands[seat]!.filter((c) => !(c.suit === card!.suit && c.rank === card!.rank)))
        : undefined;

    try {
      game = playCard(game, seat, card, declaredSuit);
    } catch (err) {
      return log.error(`Crazy8 bot play failed (seat ${seat})`, err);
    }
    room.game = game;
    this.broadcastRoom(room);
    this.afterPlay(room);
  }

  /* ── Round-end / game-over / history ──────────────────────────────────────── */

  private emitRoundResult(room: Crazy8Room): void {
    const game = room.game!;
    const last = game.history[game.history.length - 1]!;
    const playerNames = this.namesBySeat(room, game.numPlayers);
    const isBot = this.isBotBySeat(room, game.numPlayers);
    const payload: Crazy8RoundResultPayload = {
      roundNumber: last.roundNumber,
      winnerSeat: last.winnerSeat,
      pointsThisRound: [...last.pointsThisRound],
      cumulativeScores: [...last.cumulativeScores],
      playerNames,
      isBot,
    };
    this.broadcastToRoom(room, Crazy8ServerEvents.RoundResult, payload);
  }

  private async handleGameOver(room: Crazy8Room): Promise<void> {
    const game = room.game;
    if (!game) return;
    const standings = this.buildStandings(room);
    const rounds: Crazy8RoundResultPayload[] = game.history.map((r) => ({
      roundNumber: r.roundNumber,
      winnerSeat: r.winnerSeat,
      pointsThisRound: [...r.pointsThisRound],
      cumulativeScores: [...r.cumulativeScores],
      playerNames: this.namesBySeat(room, game.numPlayers),
      isBot: this.isBotBySeat(room, game.numPlayers),
    }));

    await Promise.all(
      standings.map(async (s) => {
        if (s.isBot) return;
        const delta = crazy8PayoutDelta(s.rank);
        s.moneyDelta = delta;
        s.newBalance = await adjustBalance(this.wallet, s.playerId, delta);
      }),
    );

    const payload: Crazy8GameOverPayload = { standings, rounds };
    this.broadcastToRoom(room, Crazy8ServerEvents.GameOver, payload);
    log.info(`Crazy8 room ${room.code} game over`);

    const record: Crazy8MatchRecord = {
      gameType: 'crazy8s',
      roomCode: room.code,
      playedAt: new Date().toISOString(),
      players: standings.map((s) => ({
        playerId: s.playerId,
        name: s.name,
        seat: s.seat,
        total: s.total,
        rank: s.rank,
      })),
      rounds,
    };
    this.history.saveMatch(record).catch((err) => log.error('Failed to save Crazy8 match history', err));
  }

  private buildStandings(room: Crazy8Room): Crazy8FinalStanding[] {
    const game = room.game!;
    const ranked = rankByLowest(game.scores);
    return ranked.map((r) => {
      const seat = r.seat as Seat;
      const player = room.playerBySeat(seat);
      return {
        seat,
        playerId: player?.playerId ?? '',
        name: player?.name ?? `Seat ${seat}`,
        isBot: player?.isBot ?? false,
        total: r.total,
        rank: r.rank,
      };
    });
  }

  private namesBySeat(room: Crazy8Room, numPlayers: number): string[] {
    return Array.from({ length: numPlayers }, (_, seat) => room.playerBySeat(seat)?.name ?? `Seat ${seat}`);
  }

  private isBotBySeat(room: Crazy8Room, numPlayers: number): boolean[] {
    return Array.from({ length: numPlayers }, (_, seat) => room.playerBySeat(seat)?.isBot ?? false);
  }

  /** Remove a player; free their seat, or abort/close the room as appropriate. */
  private removePlayer(room: Crazy8Room, player: Crazy8RoomPlayer): void {
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    room.players = room.players.filter((p) => p !== player);

    if (room.players.every((p) => p.isBot)) {
      this.destroyRoom(room);
      return;
    }

    if (room.game && room.game.phase !== 'gameOver') {
      this.broadcastToRoom(room, Crazy8ServerEvents.ErrorMessage, {
        message: 'A player left the table — the match has ended.',
      });
      this.destroyRoom(room);
      return;
    }

    this.broadcastRoom(room);
  }

  private destroyRoom(room: Crazy8Room): void {
    if (room.roundEndTimer) clearTimeout(room.roundEndTimer);
    for (const t of room.botTimers.values()) clearTimeout(t);
    room.botTimers.clear();
    for (const p of room.players) {
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    }
    this.rooms.delete(room.code);
    log.info(`Crazy8 room ${room.code} destroyed`);
  }

  /* ── Broadcast & utility ────────────────────────────────────────────────── */

  private broadcastRoom(room: Crazy8Room): void {
    const publicState = buildPublicRoomState(room);
    for (const p of room.players) {
      if (!p.socketId) continue;
      const self = buildSelfState(room, p);
      this.io.to(p.socketId).emit(Crazy8ServerEvents.RoomStateUpdate, { room: publicState, self });
    }
  }

  private broadcastToRoom(room: Crazy8Room, event: string, payload: unknown): void {
    for (const p of room.players) {
      if (p.socketId) this.io.to(p.socketId).emit(event, payload);
    }
  }

  private bindSocket(socket: Socket, roomCode: string): void {
    (socket.data as SocketData).crazy8RoomCode = roomCode;
  }

  private identityOf(socket: Socket): { userId: string; username: string } | null {
    const data = socket.data as SocketData;
    if (!data.userId || !data.username) return null;
    return { userId: data.userId, username: data.username };
  }

  private contextOf(socket: Socket): { room: Crazy8Room; player: Crazy8RoomPlayer } | null {
    const data = socket.data as SocketData;
    if (!data.crazy8RoomCode || !data.userId) return null;
    const room = this.rooms.get(data.crazy8RoomCode);
    if (!room) return null;
    const player = room.playerById(data.userId);
    if (!player) return null;
    return { room, player };
  }

  private emitError(socket: Socket, message: string): void {
    socket.emit(Crazy8ServerEvents.ErrorMessage, { message });
  }

  private emitRuleError(socket: Socket, err: unknown): void {
    const message = err instanceof RuleViolation ? err.message : 'Invalid move';
    this.emitError(socket, message);
  }

  private guard(fn: () => void, onError?: () => void): void {
    try {
      fn();
    } catch (err) {
      log.error('Unhandled Crazy8 handler error', err);
      onError?.();
    }
  }
}
