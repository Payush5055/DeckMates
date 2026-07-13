import type { Server, Socket } from 'socket.io';
import {
  BOT_TABLE_SIZE,
  RuleViolation,
  buildRanking,
  createGame,
  evaluateSeatHand,
  fold,
  getBetBounds,
  placeBet,
  requestShow,
  requestSideShow,
  respondToSideShow,
  seeCards,
  type GameState,
  type Seat,
} from '@cardadda/teenpatti-engine';
import {
  SESSION_TOPUP,
  STARTING_BALANCE,
  TEENPATTI_BOOT,
  settleTeenPattiSession,
} from '@cardadda/economy-engine';
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
import { WalletStore } from './wallet';
import { log } from './logger';
import { chooseAction, chooseSideShowResponse } from './teenPattiBotAI';
import { TeenPattiRoom, TeenPattiRoomPlayer } from './teenPattiRoom';
import { buildPublicRoomState, buildSelfState } from './teenPattiRedact';

/**
 * Bots act after a short, human-like pause — except in tests, which override
 * this to near-zero: a Teen Patti hand can legitimately take dozens of
 * betting turns to resolve (unlike the other three games), so a real per-turn
 * delay would make integration tests impractically slow.
 */
function botDelayMs(): number {
  const override = process.env.TEENPATTI_BOT_DELAY_MS;
  if (override !== undefined) return Number(override);
  return 800 + Math.floor(Math.random() * 700);
}

interface SocketData {
  userId?: string;
  username?: string;
  teenPattiRoomCode?: string;
}

type Ack<T> = ((res: T) => void) | undefined;

/**
 * TeenPattiGameServer — owns the Teen Patti room registry and, unlike the
 * other three games, a persistent multi-hand SESSION per room: a room is not
 * one hand but a continuous stay at a table across many hands, with each
 * real player's chip stack carrying a real (virtual) money session on top of
 * their persistent wallet balance. See @cardadda/economy-engine for the
 * settlement math; this file is only responsible for correctly feeding it
 * (server-authoritative stack/wager bookkeeping) and applying its result.
 */
export class TeenPattiGameServer {
  private rooms = new Map<string, TeenPattiRoom>();

  constructor(
    private readonly io: Server,
    private readonly history: MatchHistoryStore,
    private readonly wallet: WalletStore,
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

  private async onCreateRoom(socket: Socket, req: TeenPattiCreateRoomReq, ack: Ack<TeenPattiCreateRoomRes>): Promise<void> {
    const identity = this.identityOf(socket);
    if (!identity) return ack?.({ ok: false, error: 'Not authenticated' });
    const { userId, username } = identity;

    const fillMode = req?.mode === 'teammates' ? 'teammates' : 'bots';
    const variant = req?.variant ?? 'classic';
    const code = generateUniqueRoomCode((c) => this.rooms.has(c));
    const room = new TeenPattiRoom(code, userId, variant, fillMode);
    this.rooms.set(code, room);

    const startingPermanent = await this.wallet.getBalance(userId);
    room.wallets.set(userId, { stack: startingPermanent + SESSION_TOPUP, wagered: 0, startingPermanent });

    room.players.push({
      playerId: userId,
      name: username,
      seat: 0 as Seat,
      avatar: avatarForSeat(0),
      connected: true,
      isBot: false,
      socketId: socket.id,
      disconnectTimer: null,
      leaving: false,
    });
    this.bindSocket(socket, code);

    ack?.({ ok: true, roomCode: code });
    log.info(`Teen Patti room ${code} created by ${username} (${variant}, ${fillMode})`);

    await this.maybeStart(room);
    this.broadcastRoom(room);
    this.driveBots(room);
  }

  private async onJoinRoom(socket: Socket, req: TeenPattiJoinRoomReq, ack: Ack<TeenPattiJoinRoomRes>): Promise<void> {
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
      await this.maybeStart(room);
      this.broadcastRoom(room);
      this.driveBots(room);
      return;
    }

    if (room.game) return ack?.({ ok: false, error: 'Game already in progress' });
    const seat = room.nextFreeSeat();
    if (seat === null) return ack?.({ ok: false, error: 'Room is full' });

    // A brand-new seat always starts a brand-new session: a fresh top-up on
    // top of whatever the player's persistent balance currently is.
    const startingPermanent = await this.wallet.getBalance(userId);
    room.wallets.set(userId, { stack: startingPermanent + SESSION_TOPUP, wagered: 0, startingPermanent });

    room.players.push({
      playerId: userId,
      name: username,
      seat,
      avatar: avatarForSeat(seat),
      connected: true,
      isBot: false,
      socketId: socket.id,
      disconnectTimer: null,
      leaving: false,
    });
    this.bindSocket(socket, roomCode);
    ack?.({ ok: true, seat });

    this.broadcastRoom(room);
  }

  private async onStartNow(socket: Socket): Promise<void> {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (player.playerId !== room.hostPlayerId) return this.emitError(socket, 'Only the host can start the table');
    if (!room.canStartNow()) return this.emitError(socket, 'Need at least 2 real players to start');
    const dealt = await this.beginHand(room);
    if (!dealt) return this.emitError(socket, 'Not enough players or balance to start a hand');
    this.broadcastRoom(room);
    this.driveBots(room);
  }

  private onSeeCards(socket: Socket): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    try {
      this.transition(room, seeCards(room.game, player.seat));
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    this.settle(room);
  }

  private onBet(socket: Socket, req: TeenPattiBetReq): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    const amount = Number(req?.amount);
    const stack = room.wallets.get(player.playerId)?.stack ?? 0;
    if (amount > stack) return this.emitError(socket, 'You cannot bet more than your stack');
    try {
      this.transition(room, placeBet(room.game, player.seat, amount));
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
      this.transition(room, fold(room.game, player.seat));
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
      this.transition(room, requestShow(room.game, player.seat));
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
      this.transition(room, requestSideShow(room.game, player.seat));
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    this.settle(room);
  }

  private onRespondSideShow(socket: Socket, req: TeenPattiSideShowResReq): void {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    const { room, player } = ctx;
    if (!room.game) return this.emitError(socket, 'The game has not started yet');
    try {
      this.transition(room, respondToSideShow(room.game, player.seat, Boolean(req?.accept)));
    } catch (err) {
      return this.emitRuleError(socket, err);
    }
    this.settle(room);
  }

  private async onLeaveRoom(socket: Socket): Promise<void> {
    const ctx = this.contextOf(socket);
    if (!ctx) return;
    await this.settleAndRemovePlayer(ctx.room, ctx.player);
  }

  /**
   * Repurposed from "spin up a brand-new room" to "deal the next hand in
   * this same session" — a Teen Patti session is one continuous stay at a
   * table across many hands, not one room per hand. Any connected real
   * player may trigger the next deal once the current hand is over.
   */
  private async onPlayAgain(socket: Socket, ack: Ack<TeenPattiPlayAgainRes>): Promise<void> {
    const ctx = this.contextOf(socket);
    if (!ctx) return ack?.({ ok: false, error: 'Not in a room' });
    const { room } = ctx;
    if (room.game && room.game.phase !== 'gameOver') {
      return ack?.({ ok: false, error: 'The current hand has not finished yet' });
    }

    const dealt = await this.beginHand(room);
    if (!dealt) {
      ack?.({ ok: false, error: 'Not enough players or balance to continue' });
      return;
    }
    ack?.({ ok: true, roomCode: room.code });
    this.broadcastRoom(room);
    this.driveBots(room);
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
      if (!player.connected) void this.settleAndRemovePlayer(room, player);
    }, config.reconnectGraceMs);
  }

  private async maybeStart(room: TeenPattiRoom): Promise<void> {
    if (!room.readyToAutoStart()) return;
    room.compactSeats();
    let seat = room.nextFreeSeat();
    while (seat !== null && room.players.length < BOT_TABLE_SIZE) {
      const botId = `bot-${seat}`;
      room.wallets.set(botId, { stack: STARTING_BALANCE + SESSION_TOPUP, wagered: 0, startingPermanent: 0 });
      room.players.push({
        playerId: botId,
        name: 'Bot',
        seat,
        avatar: avatarForSeat(seat),
        connected: true,
        isBot: true,
        socketId: null,
        disconnectTimer: null,
        leaving: false,
      });
      seat = room.nextFreeSeat();
    }
    await this.beginHand(room);
  }

  /**
   * Deal a fresh hand into this room/session: settles out (removes) anyone
   * who can no longer afford the boot, tops bots back up, then deals. Returns
   * false (and may destroy the room) if too few players/balance remain.
   */
  private async beginHand(room: TeenPattiRoom): Promise<boolean> {
    this.cleanupLeavers(room);
    room.compactSeats();

    for (const player of [...room.players]) {
      const w = room.wallets.get(player.playerId);
      if (!w) continue;
      if (player.isBot) {
        if (w.stack < TEENPATTI_BOOT) w.stack = STARTING_BALANCE + SESSION_TOPUP;
        continue;
      }
      if (w.stack < TEENPATTI_BOOT) {
        await this.settleAndRemovePlayer(room, player);
      }
    }

    if (this.rooms.get(room.code) !== room) return false; // destroyed while settling above
    room.compactSeats();

    const realCount = room.players.filter((p) => !p.isBot).length;
    const viable = room.fillMode === 'bots' ? realCount >= 1 : realCount >= 2;
    if (!viable) {
      await this.destroyRoom(room);
      return false;
    }

    room.game = createGame(room.players.length, room.variant, Math.random, TEENPATTI_BOOT);
    for (const player of room.players) {
      const w = room.wallets.get(player.playerId)!;
      w.stack -= TEENPATTI_BOOT;
      if (!player.isBot) w.wagered += TEENPATTI_BOOT;
    }
    return true;
  }

  /** Apply an engine transition's money effects, then commit it as the room's new state. */
  private transition(room: TeenPattiRoom, next: GameState): void {
    const action = next.lastAction;
    if (action) {
      if (action.type === 'bet') this.debit(room, action.seat, action.amount);
      else if (action.type === 'show') this.debit(room, action.requester, action.cost);
      else if (action.type === 'sideShowRequested') this.debit(room, action.requester, action.cost);
    }
    if (next.phase === 'gameOver' && next.winner !== null) {
      this.credit(room, next.winner, next.pot);
    }
    room.game = next;
  }

  private debit(room: TeenPattiRoom, seat: Seat, amount: number): void {
    const player = room.playerBySeat(seat);
    if (!player) return;
    const w = room.wallets.get(player.playerId);
    if (!w) return;
    w.stack -= amount;
    if (!player.isBot) w.wagered += amount;
  }

  private credit(room: TeenPattiRoom, seat: Seat, amount: number): void {
    const player = room.playerBySeat(seat);
    if (!player) return;
    const w = room.wallets.get(player.playerId);
    if (!w) return;
    w.stack += amount;
  }

  /**
   * Whoever's turn it is gets auto-folded before anyone waits on them if
   * either: (a) they've already left (an explicit leave or a disconnect
   * timeout that landed mid-hand, not on their turn, so the engine's
   * turn-gated `fold` couldn't remove them immediately), or (b) — no
   * side-pots/all-in in this build (documented simplification, not a bug) —
   * they can no longer afford the engine's legal minimum bet.
   */
  private enforceTurnPreconditions(room: TeenPattiRoom): void {
    let guard = 0;
    while (room.game && room.game.phase === 'playing' && room.game.turn !== null && guard++ < 8) {
      const seat = room.game.turn;
      const player = room.playerBySeat(seat);
      if (!player) break;
      if (player.leaving) {
        this.transition(room, fold(room.game, seat));
        continue;
      }
      const w = room.wallets.get(player.playerId);
      if (!w) break;
      const { min } = getBetBounds(room.game, seat);
      if (w.stack >= min) break;
      this.transition(room, fold(room.game, seat));
    }
  }

  /** Physically remove any player marked `leaving` once it's safe (no longer an active turn-blocker). */
  private cleanupLeavers(room: TeenPattiRoom): void {
    room.players = room.players.filter((p) => {
      if (!p.leaving) return true;
      if (!room.game || room.game.phase === 'gameOver') return false;
      return room.game.active[p.seat] === true;
    });
  }

  private settle(room: TeenPattiRoom): void {
    this.enforceTurnPreconditions(room);
    this.cleanupLeavers(room);
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
          this.transition(room, respondToSideShow(room.game, player.seat, chooseSideShowResponse(room.game, player.seat)));
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
              this.transition(room, seeCards(room.game, player.seat));
              this.settle(room);
              return;
            case 'fold':
              this.transition(room, fold(room.game, player.seat));
              break;
            case 'show':
              this.transition(room, requestShow(room.game, player.seat));
              break;
            case 'sideShow':
              this.transition(room, requestSideShow(room.game, player.seat));
              this.settle(room);
              return;
            case 'bet': {
              const stack = room.wallets.get(player.playerId)?.stack ?? action.amount;
              this.transition(room, placeBet(room.game, player.seat, Math.min(action.amount, stack)));
              break;
            }
          }
        } catch (err) {
          log.error(`Teen Patti bot action failed (seat ${player.seat})`, err);
          this.transition(room, fold(room.game!, player.seat));
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
    log.info(`Teen Patti room ${room.code} hand over`);

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

  /**
   * Leaving mid-hand is exactly like being eliminated: forfeit whatever's
   * already in the pot. The engine's `fold` is turn-gated, though — it can
   * only remove them from the hand immediately if it's currently their turn.
   * Otherwise, mark them `leaving` (settled right away, but the actual seat
   * removal defers to their turn coming up, via `enforceTurnPreconditions`,
   * or the hand ending some other way, via `cleanupLeavers`) so we never
   * corrupt the in-progress hand's seat indexing. The table continues for
   * whoever's left unless too few real players remain, in which case the
   * whole room — and everyone still in it — settles and closes.
   */
  private async settleAndRemovePlayer(room: TeenPattiRoom, player: TeenPattiRoomPlayer): Promise<void> {
    if (player.disconnectTimer) {
      clearTimeout(player.disconnectTimer);
      player.disconnectTimer = null;
    }

    const midHand = room.game !== null && room.game.phase !== 'gameOver' && room.game.active[player.seat];
    if (midHand && room.game!.phase === 'playing' && room.game!.turn === player.seat) {
      this.transition(room, fold(room.game!, player.seat));
    } else if (midHand) {
      player.leaving = true;
    }

    await this.settleSession(room, player);
    if (!player.leaving) {
      room.players = room.players.filter((p) => p !== player);
    }

    const remaining = room.players.filter((p) => !p.leaving);
    const realCount = remaining.filter((p) => !p.isBot).length;
    const viable = room.fillMode === 'bots' ? realCount >= 1 : realCount >= 2;
    if (remaining.length === 0 || !viable) {
      await this.destroyRoom(room);
      return;
    }

    if (room.game && room.game.phase !== 'gameOver') {
      this.settle(room);
    } else {
      this.cleanupLeavers(room);
      this.broadcastRoom(room);
    }
  }

  /** Settle one player's session into their persistent wallet balance (server-authoritative). */
  private async settleSession(room: TeenPattiRoom, player: TeenPattiRoomPlayer): Promise<void> {
    const w = room.wallets.get(player.playerId);
    room.wallets.delete(player.playerId);
    if (player.isBot || !w) return;

    const settlement = settleTeenPattiSession({
      startingPermanent: w.startingPermanent,
      topUp: SESSION_TOPUP,
      endingAmount: w.stack,
      wagered: w.wagered,
    });
    await this.wallet.setBalance(player.playerId, settlement.newPermanentBalance);
    if (player.socketId) {
      this.io.to(player.socketId).emit(TeenPattiServerEvents.SessionSettled, settlement);
    }
  }

  private async destroyRoom(room: TeenPattiRoom): Promise<void> {
    this.rooms.delete(room.code);
    for (const timer of room.botTimers.values()) clearTimeout(timer);
    room.botTimers.clear();
    await Promise.all(room.players.map((p) => this.settleSession(room, p)));
    for (const p of room.players) {
      if (p.disconnectTimer) clearTimeout(p.disconnectTimer);
    }
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

  private guard(fn: () => void | Promise<void>, onError?: () => void): void {
    try {
      const result = fn();
      if (result instanceof Promise) {
        result.catch((err) => {
          log.error('Unhandled Teen Patti handler error', err);
          onError?.();
        });
      }
    } catch (err) {
      log.error('Unhandled Teen Patti handler error', err);
      onError?.();
    }
  }
}
