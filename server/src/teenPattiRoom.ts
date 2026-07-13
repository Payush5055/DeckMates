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
}

export class TeenPattiRoom {
  readonly code: string;
  hostPlayerId: string;
  readonly variant: TeenPattiMode;
  readonly fillMode: 'bots' | 'teammates';
  players: TeenPattiRoomPlayer[] = [];
  game: GameState | null = null;
  botTimers = new Map<number, NodeJS.Timeout>();
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
    return this.players.filter((p) => !p.isBot && p.connected).length;
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
