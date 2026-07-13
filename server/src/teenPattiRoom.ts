import { BOT_TABLE_SIZE, MAX_PLAYERS, type GameState, type Seat, type TeenPattiMode } from '@cardadda/teenpatti-engine';

export interface TeenPattiRoomPlayer {
  playerId: string;
  name: string;
  seat: Seat;
  avatar: string;
  connected: boolean;
  isBot: boolean;
  socketId: string | null;
  disconnectTimer: NodeJS.Timeout | null;
  /**
   * Set when the player has left (or their disconnect grace window expired)
   * mid-hand but it wasn't their turn, so the engine's turn-gated `fold`
   * can't remove them immediately. Their session is already settled at that
   * point — this just defers the physical seat removal until their turn
   * comes up (auto-folded then) or the hand ends.
   */
  leaving: boolean;
}

/**
 * A player's money context for the current session (one continuous stay at
 * this table, across many hands). Keyed by playerId (not seat) so it
 * survives `compactSeats()` reshuffling seat numbers when someone leaves.
 * Bots get an entry too (so hand economics — boot, bet bounds — work
 * uniformly) but `startingPermanent`/`wagered` are unused for them: bots have
 * no real wallet and are simply topped back up whenever their stack runs low.
 */
export interface TeenPattiWalletState {
  stack: number;
  wagered: number;
  startingPermanent: number;
}

export class TeenPattiRoom {
  readonly code: string;
  hostPlayerId: string;
  readonly variant: TeenPattiMode;
  readonly fillMode: 'bots' | 'teammates';
  players: TeenPattiRoomPlayer[] = [];
  game: GameState | null = null;
  botTimers = new Map<number, NodeJS.Timeout>();
  wallets = new Map<string, TeenPattiWalletState>();
  readonly createdAt = Date.now();

  constructor(code: string, hostPlayerId: string, variant: TeenPattiMode, fillMode: 'bots' | 'teammates') {
    this.code = code;
    this.hostPlayerId = hostPlayerId;
    this.variant = variant;
    this.fillMode = fillMode;
  }

  get phase(): 'waiting' | 'playing' | 'sideShow' | 'gameOver' {
    return this.game ? this.game.phase : 'waiting';
  }

  get seatsFilled(): number {
    return this.players.length;
  }

  get capacity(): number {
    return this.fillMode === 'bots' ? BOT_TABLE_SIZE : MAX_PLAYERS;
  }

  realConnectedCount(): number {
    return this.players.filter((p) => !p.isBot && p.connected && !p.leaving).length;
  }

  playerById(playerId: string): TeenPattiRoomPlayer | undefined {
    return this.players.find((p) => p.playerId === playerId);
  }

  playerBySeat(seat: number): TeenPattiRoomPlayer | undefined {
    return this.players.find((p) => p.seat === seat);
  }

  nextFreeSeat(): Seat | null {
    for (let seat = 0; seat < this.capacity; seat++) {
      if (!this.playerBySeat(seat)) return seat as Seat;
    }
    return null;
  }

  canStartNow(): boolean {
    return !this.game && this.fillMode === 'teammates' && this.realConnectedCount() >= 2;
  }

  readyToAutoStart(): boolean {
    return !this.game && this.fillMode === 'bots' && this.realConnectedCount() >= 1;
  }

  compactSeats(): void {
    this.players.forEach((p, i) => {
      p.seat = i as Seat;
    });
  }
}
