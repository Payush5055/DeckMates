/**
 * ThirtyOneGameServer — owns the 31 room registry and wires Socket.io events
 * to the pure engine. Mirrors the other two game servers' design: identity
 * from the verified handshake only, every mutation through the engine's
 * validators, personalized redacted broadcasts (no hand ever leaks).
 *
 * Registered alongside the other games on the SAME authenticated socket —
 * `thirtyone_*` event names keep the three games collision-free.
 */

import type { Server, Socket } from 'socket.io';
import {
  RuleViolation,
  createGame,
  discard,
  draw,
  eliminateSeat,
  knock,
  startNextRound,
  type Card,
  type Seat,
} from '@cardadda/thirtyone-engine';
import {
  ThirtyOneClientEvents,
  ThirtyOneServerEvents,
  type ThirtyOneCreateRoomReq,
  type ThirtyOneCreateRoomRes,
  type ThirtyOneDiscardReq,
  type ThirtyOneDrawReq,
  type ThirtyOneFinalStanding,
  type ThirtyOneGameOverPayload,
  type ThirtyOneJoinRoomReq,
  type ThirtyOneJoinRoomRes,
  type ThirtyOneMatchRecord,
  type ThirtyOnePlayAgainRes,
  type ThirtyOneRoundResultPayload,
} from '@cardadda/shared';
import { thirtyOnePayoutDelta } from '@cardadda/economy-engine';
import { config } from './config';
import { generateUniqueRoomCode } from './codes';
import { avatarForSeat } from './avatars';
import { chooseDiscard, chooseTurn } from './thirtyOneBotAI';
import { buildPublicRoomState, buildSelfState } from './thirtyOneRedact';
import { ThirtyOneRoom, ThirtyOneRoomPlayer } from './thirtyOneRoom';
import { MatchHistoryStore } from './persistence';
import { adjustBalance, WalletStore } from './wallet';
import { log } from './logger';

/** Bots act after a short, human-like pause (same convention as the others). */
function botDelayMs(): number {
  return 800 + Math.floor(Math.random() * 700);
}

interface SocketData {
  userId?: string;
  username?: string;
  thirtyOneRoomCode?: string;
}

type Ack<T> = ((res: T) => void) | undefined;

export class ThirtyOneGameServer {
  private rooms = new Map<string, ThirtyOneRoom>();

  constructor(
    private readonly io: Server,
    private readonly history: MatchHistoryStore,
    private readonly wallet: WalletStore,
  ) {}

  register(socket: Socket): void {
    socket.on(ThirtyOneClientEvents.CreateRoom, (req: ThirtyOneCreateRoomReq, ack: Ack<ThirtyOneCreateRoomRes>) =>
      this.guard(() => this.onCreateRoom(socket, req, ack), () => ack?.({ ok: false, error: 'Server error' })),
    );
    socket.on(ThirtyOneClientEvents.JoinRoom, (req: ThirtyOneJoinRoomReq, ack: Ack<ThirtyOneJoinRoomRes>) =>
      this.guard(() => this.onJoinRoom(socket, req, ack), () => ack?.({ ok: false, error: 'Server error' })),
    );
    socket.on(ThirtyOneClientEvents.Knock, () => this.guard(() => this.onKnock(socket)));
    socket.on(ThirtyOneClientEvents.DrawCard, (req: ThirtyOneDrawReq) =>
      this.guard(() => this.onDraw(socket, req)),
    );
    socket.on(ThirtyOneClientEvents.DiscardCard, (req: ThirtyOneDiscardReq) =>
      this.guard(() => this.onDiscard(socket, req)),
    );
    socket.on(ThirtyOneClientEvents.LeaveRoom, () => this.guard(() => this.onLeaveRoom(socket)));
    socket.on(ThirtyOneClientEvents.PlayAgain, (ack: Ack<ThirtyOnePlayAgainRes>) =>
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

  private onCreateRoom(socket: Socket, req: ThirtyOneCreateRoomReq, ack: Ack<ThirtyOneCreateRoomRes>): void {
    const identity = this.identityOf(socket);
    if (!identity) return ack?.({ ok: false, error: 'Not authenticated' });
    const { userId, username } = identity;

    const code = generateUniqueRoomCode((c) => this.rooms.has(c));
    const room = new ThirtyOneRoom(code, userId);
    if (req?.mode === 'bots') {
      room.expectedRealPlayers = 1;
    } else {
      const teammates = Math.max(1, Math.min(3, Number(req?.teammates) || 3));
      room.expectedRealPlayers = 1 + teammates;
    }
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
      hasVoluntarilyLeft: false,
    });
    this.bindSocket(socket, code);

    log.info(`31 room ${code} created by ${username} (expects ${room.expectedRealPlayers} real)`);
    ack?.({ ok: true, roomCode: code });
    this.maybeStart(room);
    this.settle(room);
  }

  private onJoinRoom(socket: Socket, req: ThirtyOneJoinRoomReq, ack: Ack<ThirtyOneJoinRoomRes>): void {
    const identity = this.identityOf(socket);
    if (!identity) return ack?.({ ok: false, error: 'Not authenticated' });
    const { userId, username } = identity;
    const roomCode = String(req?.roomCode ?? '').trim().toUpperCase();

    const room = this.rooms.get(roomCode);
    if (!room) return ack?.({ ok: false, error: 'Room not found' });

    const existing = room.playerById(userId);
    if (existing) {
      // A player who voluntarily left (or was force-eliminated after an
      // unresponsive drop) mid-match does NOT get spectator status back —
      // that's reserved for players who lost through ordinary gameplay.
      if (existing.hasVoluntarilyLeft) {
        return ack?.({ ok: false, error: 'You left this match and cannot rejoin' });
      }
      if (existing.disconnectTimer) {
        clearTimeout(existing.disconnectTimer);
        existing.disconnectTimer = null;
      }
      existing.connected = true;
      existing.socketId = socket.id;
      existing.name = username;
      this.bindSocket(socket, roomCode);
      ack?.({ ok: true, seat: existing.seat });
      log.info(`Player ${username} reconnected to 31 ${roomCode} (seat ${existing.seat})`);
      this.maybeStart(room);
      this.settle(room);
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
      hasVoluntarilyLeft: false,
    });
    this.bindSocket(socket, roomCode);
    ack?.({ ok: true, seat });
    log.info(`Player ${username} joined 31 ${roomCode} (seat ${seat})`);

    this.maybeStart(room);
    this.settle(room);
  }

  private onKnock(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    try {
      room.game = knock(room.game, player.seat);
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    log.info(`31 ${room.code}: ${player.name} knocked`);
    this.settle(room);
  }

  private onDraw(socket: Socket, req: ThirtyOneDrawReq): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    const source = req?.source === 'discard' ? 'discard' : 'pile';
    try {
      room.game = draw(room.game, player.seat, source, Math.random);
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    this.settle(room);
  }

  private onDiscard(socket: Socket, req: ThirtyOneDiscardReq): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    try {
      room.game = discard(room.game, player.seat, req?.card as Card);
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    this.settle(room);
  }

  /**
   * Leave lifecycle for 31 — deliberately NOT the Callbreak/Crazy8s pattern
   * (where any mid-match departure aborts the room), since 31 is designed to
   * survive a shrinking player pool:
   *   • Pre-game (waiting room): simple removal, same as the other games.
   *   • Host, mid-match or post-match: the ONE thing that ends the room for
   *     everyone. The client gates this behind a confirmation dialog; the
   *     server trusts that an explicit leave_room from the host means it was
   *     confirmed.
   *   • Non-host: always free to leave immediately. If they still have lives
   *     in an ongoing match, that's treated exactly like being eliminated —
   *     the match continues for whoever's left. They may not rejoin as a
   *     spectator afterward (see the `hasVoluntarilyLeft` join-time guard).
   */
  private onLeaveRoom(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;

    if (!room.game) {
      this.removeFromWaitingRoom(room, player);
      return;
    }

    if (player.playerId === room.hostPlayerId) {
      this.endRoomForEveryone(room, `${player.name} (the host) left — the match has ended.`);
      return;
    }

    player.hasVoluntarilyLeft = true;
    this.disconnectSocketOnly(player);
    this.eliminateIfAliveAndContinue(room, player);
  }

  private onPlayAgain(socket: Socket, ack: Ack<ThirtyOnePlayAgainRes>): void {
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
    const newRoom = new ThirtyOneRoom(newCode, host);
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
        hasVoluntarilyLeft: false,
      });
    });
    this.rooms.set(newCode, newRoom);

    for (const p of survivors) {
      if (p.socketId) this.io.to(p.socketId).emit(ThirtyOneServerEvents.PlayAgainRoom, { roomCode: newCode });
    }
    ack?.({ ok: true, roomCode: newCode });
    log.info(`31 play again: ${room.code} → ${newCode} with ${survivors.length} players`);
    this.destroyRoom(room);
  }

  private onDisconnect(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;

    player.connected = false;
    player.socketId = null;
    log.info(`Player ${player.playerId} dropped from 31 ${room.code}; holding seat ${player.seat}`);
    this.broadcastRoom(room);

    player.disconnectTimer = setTimeout(() => {
      player.disconnectTimer = null;
      if (player.connected) return; // reconnected within the grace window

      log.info(`Grace expired for ${player.playerId} in 31 ${room.code}`);
      if (!room.game) {
        // Pre-game: unchanged from before — just free the seat.
        this.removeFromWaitingRoom(room, player);
        return;
      }
      // Mid-match or post-match: an unresponsive drop is NEVER allowed to end
      // the room outright — that's reserved for an explicit, CONFIRMED host
      // Leave. An unreturned player (host or not) is instead treated exactly
      // like a voluntary departure: eliminated if still alive, match
      // continues. (A silent timeout can't have been "confirmed" by anyone,
      // so it never triggers the host's room-ending path.)
      this.eliminateIfAliveAndContinue(room, player);
    }, config.reconnectGraceMs);
  }

  /* ── Lifecycle ──────────────────────────────────────────────────────────── */

  private maybeStart(room: ThirtyOneRoom): void {
    if (!room.readyToStart()) return;
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
        hasVoluntarilyLeft: false,
      });
      seat = room.nextFreeSeat();
    }
    // createGame can END the round immediately (someone dealt exactly 31) —
    // settle() right after handles that uniformly.
    room.game = createGame(Math.random);
    const bots = room.players.filter((p) => p.isBot).length;
    log.info(`31 room ${room.code} starting — ${room.players.length - bots} real + ${bots} bots`);
  }

  /**
   * Broadcast, then route on the engine phase. Called after EVERY state
   * change — createGame and startNextRound can land directly in roundEnd
   * (a dealt 31) or even gameOver, so all paths funnel through here.
   */
  private settle(room: ThirtyOneRoom): void {
    const game = room.game;
    this.broadcastRoom(room);
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

  private scheduleNextRound(room: ThirtyOneRoom): void {
    if (room.roundEndTimer) clearTimeout(room.roundEndTimer);
    room.roundEndTimer = setTimeout(() => {
      room.roundEndTimer = null;
      if (!room.game || room.game.phase !== 'roundEnd') return;
      room.game = startNextRound(room.game, Math.random);
      this.settle(room);
    }, config.roundEndDelayMs * 2); // the reveal has more to read than other games
  }

  /* ── Bots ───────────────────────────────────────────────────────────────── */

  private driveBots(room: ThirtyOneRoom): void {
    const game = room.game;
    if (!game || game.phase !== 'playing') return;
    const seat = game.turn;
    const player = room.playerBySeat(seat);
    if (player?.isBot && !room.botTimers.has(seat)) {
      const timer = setTimeout(() => {
        room.botTimers.delete(seat);
        this.performBotStep(room, seat);
      }, botDelayMs());
      room.botTimers.set(seat, timer);
    }
  }

  /**
   * One bot step per timer tick: knock, draw, or discard — so humans see the
   * bot's draw land before its discard, with a beat in between.
   */
  private performBotStep(room: ThirtyOneRoom, seat: Seat): void {
    const game = room.game;
    if (!game || game.phase !== 'playing' || game.turn !== seat) return;

    try {
      if (game.stage === 'draw') {
        const decision = chooseTurn(game, seat);
        room.game = decision.action === 'knock' ? knock(game, seat) : draw(game, seat, decision.source, Math.random);
      } else {
        room.game = discard(game, seat, chooseDiscard(game, seat));
      }
    } catch (err) {
      return log.error(`31 bot step failed (seat ${seat})`, err);
    }
    this.settle(room);
  }

  /* ── Round results / game over / history ───────────────────────────────── */

  private emitRoundResult(room: ThirtyOneRoom): void {
    const game = room.game!;
    const last = game.history[game.history.length - 1];
    if (!last) return;
    const payload: ThirtyOneRoundResultPayload = {
      roundNumber: last.roundNumber,
      reason: last.reason,
      knockerSeat: last.knockerSeat,
      winners31: [...last.winners31],
      revealedHands: last.revealedHands.map((h) => (h ? [...h] : null)),
      handValues: [...last.handValues],
      livesLost: [...last.livesLost],
      livesAfter: [...last.livesAfter],
      doublePenalty: last.doublePenalty,
      voided: last.voided,
      playerNames: this.namesBySeat(room),
      isBot: this.isBotBySeat(room),
    };
    this.broadcastToRoom(room, ThirtyOneServerEvents.RoundResult, payload);
  }

  private async handleGameOver(room: ThirtyOneRoom): Promise<void> {
    const game = room.game;
    if (!game) return;
    const standings = this.buildStandings(room);
    const rounds: ThirtyOneRoundResultPayload[] = game.history.map((r) => ({
      roundNumber: r.roundNumber,
      reason: r.reason,
      knockerSeat: r.knockerSeat,
      winners31: [...r.winners31],
      revealedHands: r.revealedHands.map((h) => (h ? [...h] : null)),
      handValues: [...r.handValues],
      livesLost: [...r.livesLost],
      livesAfter: [...r.livesAfter],
      doublePenalty: r.doublePenalty,
      voided: r.voided,
      playerNames: this.namesBySeat(room),
      isBot: this.isBotBySeat(room),
    }));

    await Promise.all(
      standings.map(async (s) => {
        if (s.isBot) return;
        const delta = thirtyOnePayoutDelta(s.rank === 1);
        s.moneyDelta = delta;
        s.newBalance = await adjustBalance(this.wallet, s.playerId, delta);
      }),
    );

    const payload: ThirtyOneGameOverPayload = { standings, rounds };
    this.broadcastToRoom(room, ThirtyOneServerEvents.GameOver, payload);
    log.info(`31 room ${room.code} game over`);

    const record: ThirtyOneMatchRecord = {
      gameType: '31',
      roomCode: room.code,
      playedAt: new Date().toISOString(),
      players: standings.map((s) => ({
        playerId: s.playerId,
        name: s.name,
        seat: s.seat,
        lives: s.lives,
        rank: s.rank,
      })),
      rounds,
    };
    this.history.saveMatch(record).catch((err) => log.error('Failed to save 31 match history', err));
  }

  /** Survivor 1st; everyone else ranked by how long they lasted (later
   * elimination = better), ties sharing a rank. */
  private buildStandings(room: ThirtyOneRoom): ThirtyOneFinalStanding[] {
    const game = room.game!;
    const order = ([0, 1, 2, 3] as Seat[])
      .map((seat) => ({
        seat,
        lives: game.lives[seat]!,
        elim: game.eliminationRound[seat] ?? Number.POSITIVE_INFINITY,
      }))
      .sort((a, b) => (b.lives - a.lives) || (b.elim - a.elim));

    const standings: ThirtyOneFinalStanding[] = [];
    order.forEach((entry, i) => {
      const prev = order[i - 1];
      const tied = prev && prev.lives === entry.lives && prev.elim === entry.elim;
      const rank = tied ? standings[i - 1]!.rank : i + 1;
      const player = room.playerBySeat(entry.seat);
      standings.push({
        seat: entry.seat,
        playerId: player?.playerId ?? '',
        name: player?.name ?? `Seat ${entry.seat}`,
        isBot: player?.isBot ?? false,
        lives: entry.lives,
        rank,
      });
    });
    return standings;
  }

  private namesBySeat(room: ThirtyOneRoom): string[] {
    return [0, 1, 2, 3].map((s) => room.playerBySeat(s)?.name ?? `Seat ${s}`);
  }

  private isBotBySeat(room: ThirtyOneRoom): boolean[] {
    return [0, 1, 2, 3].map((s) => room.playerBySeat(s)?.isBot ?? false);
  }

  /* ── Membership / teardown ──────────────────────────────────────────────── */

  /**
   * Pre-game only: a departing player simply frees their waiting-room seat.
   * Unchanged from the other two games' behavior — there's no elimination
   * concept before a match has even started.
   */
  private removeFromWaitingRoom(room: ThirtyOneRoom, player: ThirtyOneRoomPlayer): void {
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    room.players = room.players.filter((p) => p !== player);
    if (room.players.length === 0 || room.players.every((p) => p.isBot)) {
      this.destroyRoom(room);
      return;
    }
    this.broadcastRoom(room);
  }

  /**
   * The ONE thing that ends a 31 match for everyone: an explicit, CONFIRMED
   * host Leave — mid-match, or even while the host is just spectating after
   * their own elimination. Never triggered by elimination itself, a non-host
   * leaving, or a silent disconnect timeout.
   */
  private endRoomForEveryone(room: ThirtyOneRoom, message: string): void {
    this.broadcastToRoom(room, ThirtyOneServerEvents.ErrorMessage, { message });
    this.destroyRoom(room);
  }

  /** Detach a player's socket binding without touching game state — used when
   * THEY are the one actively leaving (as opposed to a passive disconnect). */
  private disconnectSocketOnly(player: ThirtyOneRoomPlayer): void {
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }
    player.connected = false;
    player.socketId = null;
  }

  /**
   * Shared by "non-host voluntary leave" and "unresponsive drop after the
   * grace window": if the player still has lives in an ongoing match, force-
   * eliminate their seat — the match simply continues with whoever's left,
   * exactly as it would after a normal reveal-driven elimination. If they're
   * already eliminated/spectating, or the match already ended, there's
   * nothing to change. Cleans up a room nobody real is watching anymore;
   * otherwise just broadcasts the (possibly updated) state.
   */
  private eliminateIfAliveAndContinue(room: ThirtyOneRoom, player: ThirtyOneRoomPlayer): void {
    const game = room.game;
    if (game && game.phase !== 'gameOver' && (game.lives[player.seat] ?? 0) > 0) {
      try {
        room.game = eliminateSeat(game, player.seat);
      } catch (err) {
        log.error('31: eliminateSeat failed', err);
      }
    }
    if (room.players.every((p) => p.isBot || !p.connected)) {
      // Nobody real is left to watch — safe to quietly clean up.
      this.destroyRoom(room);
      return;
    }
    this.settle(room);
  }

  private destroyRoom(room: ThirtyOneRoom): void {
    if (room.roundEndTimer) clearTimeout(room.roundEndTimer);
    for (const t of room.botTimers.values()) clearTimeout(t);
    room.botTimers.clear();
    for (const p of room.players) {
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    }
    this.rooms.delete(room.code);
    log.info(`31 room ${room.code} destroyed`);
  }

  /* ── Broadcast & utility ────────────────────────────────────────────────── */

  private broadcastRoom(room: ThirtyOneRoom): void {
    const publicState = buildPublicRoomState(room);
    for (const p of room.players) {
      if (!p.socketId) continue;
      const self = buildSelfState(room, p);
      this.io.to(p.socketId).emit(ThirtyOneServerEvents.RoomStateUpdate, { room: publicState, self });
    }
  }

  private broadcastToRoom(room: ThirtyOneRoom, event: string, payload: unknown): void {
    for (const p of room.players) {
      if (p.socketId) this.io.to(p.socketId).emit(event, payload);
    }
  }

  private bindSocket(socket: Socket, roomCode: string): void {
    (socket.data as SocketData).thirtyOneRoomCode = roomCode;
  }

  private identityOf(socket: Socket): { userId: string; username: string } | null {
    const data = socket.data as SocketData;
    if (!data.userId || !data.username) return null;
    return { userId: data.userId, username: data.username };
  }

  private contextOf(socket: Socket): { room: ThirtyOneRoom; player: ThirtyOneRoomPlayer } | null {
    const data = socket.data as SocketData;
    if (!data.thirtyOneRoomCode || !data.userId) return null;
    const room = this.rooms.get(data.thirtyOneRoomCode);
    if (!room) return null;
    const player = room.playerById(data.userId);
    if (!player) return null;
    return { room, player };
  }

  private emitError(socket: Socket, message: string): void {
    socket.emit(ThirtyOneServerEvents.ErrorMessage, { message });
  }

  private emitRuleError(socket: Socket, err: unknown): void {
    const message = err instanceof RuleViolation ? err.message : 'Invalid move';
    this.emitError(socket, message);
  }

  private guard(fn: () => void, onError?: () => void): void {
    try {
      fn();
    } catch (err) {
      log.error('Unhandled 31 handler error', err);
      onError?.();
    }
  }
}
