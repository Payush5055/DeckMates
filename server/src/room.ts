import { GameState, NUM_PLAYERS, SEATS, Seat } from '@cardadda/engine';
import type { RoomPhase } from '@cardadda/shared';

/** A seated participant. `seat` is the source of truth for table position. */
export interface RoomPlayer {
  playerId: string;
  name: string;
  seat: Seat;
  avatar: string;
  connected: boolean;
  /** Current socket id, or null while disconnected (within the grace window). */
  socketId: string | null;
  /** Pending removal timer for a dropped player; cleared on reconnect. */
  disconnectTimer: NodeJS.Timeout | null;
}

/**
 * In-memory authoritative state for one table. The server keeps a `Map<code,
 * Room>`; this object owns the engine `GameState` plus connection bookkeeping.
 */
export class Room {
  readonly code: string;
  hostPlayerId: string;
  players: RoomPlayer[] = [];
  /** Engine state; null while the room is still filling (waiting phase). */
  game: GameState | null = null;
  /** Timer bridging roundEnd → next deal. */
  roundEndTimer: NodeJS.Timeout | null = null;
  readonly createdAt = Date.now();

  constructor(code: string, hostPlayerId: string) {
    this.code = code;
    this.hostPlayerId = hostPlayerId;
  }

  /** 'waiting' until a game exists, then mirrors the engine phase. */
  get phase(): RoomPhase {
    return this.game ? this.game.phase : 'waiting';
  }

  get seatsFilled(): number {
    return this.players.length;
  }

  playerById(playerId: string): RoomPlayer | undefined {
    return this.players.find((p) => p.playerId === playerId);
  }

  playerBySeat(seat: Seat): RoomPlayer | undefined {
    return this.players.find((p) => p.seat === seat);
  }

  playerBySocket(socketId: string): RoomPlayer | undefined {
    return this.players.find((p) => p.socketId === socketId);
  }

  connectedPlayers(): RoomPlayer[] {
    return this.players.filter((p) => p.connected);
  }

  /** Lowest unoccupied seat, or null if the table is full. */
  nextFreeSeat(): Seat | null {
    for (const seat of SEATS) {
      if (!this.playerBySeat(seat)) return seat;
    }
    return null;
  }

  /** True when all four seats are taken AND everyone is currently connected. */
  isReadyToStart(): boolean {
    return (
      !this.game &&
      this.players.length === NUM_PLAYERS &&
      this.players.every((p) => p.connected)
    );
  }
}
