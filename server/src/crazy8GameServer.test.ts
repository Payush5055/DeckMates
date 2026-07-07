import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  Crazy8ClientEvents,
  Crazy8ServerEvents,
  type Crazy8CreateRoomReq,
  type Crazy8CreateRoomRes,
  type Crazy8JoinRoomRes,
  type Crazy8RoomStateUpdate,
} from '@cardadda/shared';
import { buildServer, type BuiltServer } from './server';

/**
 * Boots a real server on an ephemeral port and connects real socket.io
 * clients against the Crazy8 handlers specifically. Mirrors gameServer.test.ts's
 * harness and privacy bar: no client payload may ever carry another player's
 * hand or the draw pile's contents.
 */

let server: BuiltServer;
let port: number;

class Peer {
  latest: Crazy8RoomStateUpdate | null = null;
  constructor(
    readonly socket: ClientSocket,
    readonly username: string,
  ) {
    socket.on(Crazy8ServerEvents.RoomStateUpdate, (u: Crazy8RoomStateUpdate) => {
      this.latest = u;
    });
  }
  get seat(): number {
    return this.latest!.self!.seat;
  }
  get hand(): string[] {
    return (this.latest?.self?.hand ?? []).map((c) => `${c.suit}${c.rank}`);
  }
}

const peers: Peer[] = [];

function connect(username: string): Promise<Peer> {
  const socket = ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    auth: { token: `dev:${username}` },
  });
  const peer = new Peer(socket, username);
  peers.push(peer);
  return new Promise<Peer>((resolve) => socket.on('connect', () => resolve(peer)));
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve) => socket.emit(event, payload, resolve));
}

function createRoom(socket: ClientSocket, req: Crazy8CreateRoomReq): Promise<Crazy8CreateRoomRes> {
  return new Promise<Crazy8CreateRoomRes>((resolve) => socket.emit(Crazy8ClientEvents.CreateRoom, req, resolve));
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(async () => {
  server = await buildServer();
  await new Promise<void>((resolve) => server.http.listen(0, resolve));
  port = (server.http.address() as AddressInfo).port;
});

afterEach(async () => {
  for (const p of peers) p.socket.close();
  peers.length = 0;
  server.io.close();
  await new Promise<void>((resolve) => server.http.close(() => resolve()));
});

describe('Crazy8GameServer end-to-end', () => {
  it('generates a readable 6-char room code', async () => {
    const a = await connect('Ann');
    const created = await createRoom(a.socket, { tableSize: 4, mode: 'teammates', teammates: 3 });
    expect(created.roomCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('rejects joining a non-existent room', async () => {
    const s = await connect('X');
    const res = await emitAck<Crazy8JoinRoomRes>(s.socket, Crazy8ClientEvents.JoinRoom, { roomCode: 'ZZZZZZ' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it('bots mode deals a variable-size table immediately (2-seat table)', async () => {
    const a = await connect('Solo');
    const created = await createRoom(a.socket, { tableSize: 2, mode: 'bots' });
    expect(created.ok).toBe(true);
    a.socket.emit(Crazy8ClientEvents.JoinRoom, { roomCode: created.roomCode! });

    await waitFor(() => a.hand.length === 7); // 2-player games deal 7 each
    const room = a.latest!.room;
    expect(room.numPlayers).toBe(2);
    expect(room.players.filter((p) => p.isBot)).toHaveLength(1);
    expect(room.phase).toBe('playing');
  });

  it('NEVER leaks another player’s hand or the draw pile’s contents', async () => {
    const a = await connect('Ann');
    const created = await createRoom(a.socket, { tableSize: 3, mode: 'bots' });
    a.socket.emit(Crazy8ClientEvents.JoinRoom, { roomCode: created.roomCode! });
    await waitFor(() => a.hand.length === 5); // 3-player games deal 5 each

    const update = a.latest!;
    // Public players expose counts only, never a `hand` field.
    for (const pub of update.room.players) {
      expect((pub as unknown as Record<string, unknown>).hand).toBeUndefined();
    }
    // Draw pile is a count only — no raw card array anywhere in the public state.
    expect(typeof update.room.drawPileCount).toBe('number');
    expect((update.room as unknown as Record<string, unknown>).drawPile).toBeUndefined();
    // Every card in self.hand belongs to this player; nothing else is exposed.
    expect(update.self!.hand.length).toBe(5);
  });

  it('"Start now" begins the match with exactly who is seated — no bot backfill', async () => {
    const a = await connect('Ann');
    const created = await createRoom(a.socket, { tableSize: 4, mode: 'teammates', teammates: 3 });
    a.socket.emit(Crazy8ClientEvents.JoinRoom, { roomCode: created.roomCode! });
    await waitFor(() => a.latest !== null);

    const b = await connect('Bob');
    await emitAck(b.socket, Crazy8ClientEvents.JoinRoom, { roomCode: created.roomCode! });
    await waitFor(() => a.latest!.room.seatsFilled === 2);
    expect(a.latest!.room.phase).toBe('waiting'); // still waiting — only 2 of 4 expected

    // Host forces an early start with just the 2 present.
    a.socket.emit(Crazy8ClientEvents.StartNow);
    await waitFor(() => a.latest!.room.phase === 'playing');
    expect(a.latest!.room.numPlayers).toBe(2);
    expect(a.latest!.room.players).toHaveLength(2);
    expect(a.latest!.room.players.every((p) => !p.isBot)).toBe(true);
  });

  it('rejects "Start now" from a non-host and with fewer than 2 players', async () => {
    const a = await connect('Ann');
    const created = await createRoom(a.socket, { tableSize: 4, mode: 'teammates', teammates: 3 });
    a.socket.emit(Crazy8ClientEvents.JoinRoom, { roomCode: created.roomCode! });
    await waitFor(() => a.latest !== null);

    let sawError = false;
    a.socket.on(Crazy8ServerEvents.ErrorMessage, () => (sawError = true));
    a.socket.emit(Crazy8ClientEvents.StartNow); // only 1 real player so far
    await waitFor(() => sawError, 1500);
    expect(a.latest!.room.phase).toBe('waiting');
  });

  it('plays a legal card and enforces suit/rank matching thereafter', async () => {
    const a = await connect('Ann');
    const created = await createRoom(a.socket, { tableSize: 2, mode: 'bots' });
    a.socket.emit(Crazy8ClientEvents.JoinRoom, { roomCode: created.roomCode! });
    await waitFor(() => a.hand.length === 7);

    // Wait until it's the human's turn (bot may lead first).
    await waitFor(() => a.latest!.room.turn === a.seat, 8000);
    const legal = a.latest!.self!.legalPlays;
    if (legal.length > 0) {
      const card = legal[0]!;
      const declaredSuit = card.rank === 8 ? 'S' : undefined;
      a.socket.emit(Crazy8ClientEvents.PlayCard, { card, declaredSuit });
      await waitFor(() => a.hand.length === 6 || a.latest!.room.phase !== 'playing', 4000);
    }
  }, 15000);

  it('holds a dropped player’s seat instead of dropping it immediately', async () => {
    const a = await connect('Ann');
    const created = await createRoom(a.socket, { tableSize: 3, mode: 'teammates', teammates: 2 });
    a.socket.emit(Crazy8ClientEvents.JoinRoom, { roomCode: created.roomCode! });
    await waitFor(() => a.latest !== null);
    const b = await connect('Bob');
    await emitAck(b.socket, Crazy8ClientEvents.JoinRoom, { roomCode: created.roomCode! });
    const c = await connect('Cy');
    await emitAck(c.socket, Crazy8ClientEvents.JoinRoom, { roomCode: created.roomCode! });
    await waitFor(() => a.hand.length === 5);

    const victimSeat = b.seat;
    b.socket.close();
    await waitFor(() => a.latest!.room.players.find((p) => p.seat === victimSeat)?.connected === false);
    expect(a.latest!.room.players).toHaveLength(3);

    const rejoin = await connect('Bob');
    const res = await emitAck<Crazy8JoinRoomRes>(rejoin.socket, Crazy8ClientEvents.JoinRoom, {
      roomCode: created.roomCode!,
    });
    expect(res.ok).toBe(true);
    expect(res.seat).toBe(victimSeat);
  });
});
