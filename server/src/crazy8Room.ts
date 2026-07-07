import type { GameState, Seat } from '@cardadda/crazy8-engine';

/** A seated participant. `seat` is the source of truth for table position. */
export interface Crazy8RoomPlayer {
  playerId: string;
  name: string;
  seat: Seat;
  avatar: string;
  connected: boolean;
  /** Server-controlled bot seat (no socket; the server drives its actions). */
  isBot: boolean;
  /** Current socket id, or null while disconnected (within the grace window). */
  socketId: string | null;
  /** Pending removal timer for a dropped player; cleared on reconnect. */
  disconnectTimer: NodeJS.Timeout | null;
}

/**
 * In-memory authoritative state for one Crazy 8s table. Unlike Callbreak's
 * fixed 4-seat Room, tables here seat a variable 2–4 players (`tableSize`,
 * chosen by the host), and a match can also be started manually with fewer
 * real players than originally targeted (no bot backfill) via "Start now".
 */
export class Crazy8Room {
  readonly code: string;
  hostPlayerId: string;
  /** The host's originally targeted seat count (2–4). */
  tableSize: number;
  players: Crazy8RoomPlayer[] = [];
  /** Engine state; null while the room is still filling (waiting phase). */
  game: GameState | null = null;
  /** Timer bridging roundEnd → next deal. */
  roundEndTimer: NodeJS.Timeout | null = null;
  /** Pending bot-action timers, keyed by seat. */
  botTimers = new Map<number, NodeJS.Timeout>();
  /**
   * How many REAL (non-bot) players must be seated before auto-start backfills
   * any remaining empty seats (up to `tableSize`) with bots. 'bots' mode = 1
   * (just the host); 'teammates' mode = 1 + teammates.
   */
  expectedRealPlayers: number;
  readonly createdAt = Date.now();

  constructor(code: string, hostPlayerId: string, tableSize: number) {
    this.code = code;
    this.hostPlayerId = hostPlayerId;
    this.tableSize = tableSize;
    this.expectedRealPlayers = tableSize;
  }

  /** Count of currently-connected real (non-bot) players. */
  realConnectedCount(): number {
    return this.players.filter((p) => !p.isBot && p.connected).length;
  }

  /** 'waiting' until a game exists, then mirrors the engine phase. */
  get phase(): 'waiting' | 'playing' | 'roundEnd' | 'gameOver' {
    return this.game ? this.game.phase : 'waiting';
  }

  get seatsFilled(): number {
    return this.players.length;
  }

  playerById(playerId: string): Crazy8RoomPlayer | undefined {
    return this.players.find((p) => p.playerId === playerId);
  }

  playerBySeat(seat: number): Crazy8RoomPlayer | undefined {
    return this.players.find((p) => p.seat === seat);
  }

  connectedPlayers(): Crazy8RoomPlayer[] {
    return this.players.filter((p) => p.connected);
  }

  /** Lowest unoccupied seat within [0, tableSize), or null if full. */
  nextFreeSeat(): Seat | null {
    for (let s = 0; s < this.tableSize; s++) {
      if (!this.playerBySeat(s)) return s as Seat;
    }
    return null;
  }

  /** True when enough real players are seated to auto-start (bots fill the rest). */
  readyToStart(): boolean {
    return !this.game && this.realConnectedCount() >= this.expectedRealPlayers;
  }

  /** True when the host may force an early start with just who's here (>=2, no bots). */
  canStartNow(): boolean {
    return !this.game && this.realConnectedCount() >= 2;
  }

  /**
   * Reassign contiguous seat numbers (0..N-1) in current array order. A
   * permanent mid-waiting-room departure can leave a gap (e.g. seats 0 and 2
   * occupied, 1 empty) if no one joins to refill it before the match starts —
   * the engine requires seats to be exactly 0..numPlayers-1, so this MUST be
   * called right before dealing (either auto-start or manual "start now").
   */
  compactSeats(): void {
    this.players.forEach((p, i) => {
      p.seat = i as Seat;
    });
  }
}
