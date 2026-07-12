import type { GameState, Seat } from '@cardadda/thirtyone-engine';
import { NUM_PLAYERS } from '@cardadda/thirtyone-engine';

/** A seated participant. `seat` is the source of truth for table position. */
export interface ThirtyOneRoomPlayer {
  playerId: string;
  name: string;
  seat: Seat;
  avatar: string;
  connected: boolean;
  /** Server-controlled bot seat (no socket; the server drives its actions). */
  isBot: boolean;
  socketId: string | null;
  /** Pending removal timer for a dropped player; cleared on reconnect. */
  disconnectTimer: NodeJS.Timeout | null;
}

/**
 * In-memory authoritative state for one 31 table. Always 4 seats — bots fill
 * any seats left empty when the match starts (same convention as Callbreak).
 */
export class ThirtyOneRoom {
  readonly code: string;
  hostPlayerId: string;
  players: ThirtyOneRoomPlayer[] = [];
  /** Engine state; null while the room is still filling (waiting phase). */
  game: GameState | null = null;
  /** Timer bridging roundEnd (the reveal screen) → next deal. */
  roundEndTimer: NodeJS.Timeout | null = null;
  /** Pending bot-action timers, keyed by seat. */
  botTimers = new Map<Seat, NodeJS.Timeout>();
  /** Real players required before auto-start backfills the rest with bots. */
  expectedRealPlayers = NUM_PLAYERS;
  readonly createdAt = Date.now();

  constructor(code: string, hostPlayerId: string) {
    this.code = code;
    this.hostPlayerId = hostPlayerId;
  }

  realConnectedCount(): number {
    return this.players.filter((p) => !p.isBot && p.connected).length;
  }

  get phase(): 'waiting' | 'playing' | 'roundEnd' | 'gameOver' {
    return this.game ? this.game.phase : 'waiting';
  }

  get seatsFilled(): number {
    return this.players.length;
  }

  playerById(playerId: string): ThirtyOneRoomPlayer | undefined {
    return this.players.find((p) => p.playerId === playerId);
  }

  playerBySeat(seat: number): ThirtyOneRoomPlayer | undefined {
    return this.players.find((p) => p.seat === seat);
  }

  nextFreeSeat(): Seat | null {
    for (let s = 0; s < NUM_PLAYERS; s++) {
      if (!this.playerBySeat(s)) return s as Seat;
    }
    return null;
  }

  readyToStart(): boolean {
    return !this.game && this.realConnectedCount() >= this.expectedRealPlayers;
  }
}
