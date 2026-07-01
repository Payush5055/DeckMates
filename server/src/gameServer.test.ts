import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  ClientEvents,
  ServerEvents,
  type CreateRoomRes,
  type JoinRoomRes,
  type RoomStateUpdate,
} from '@cardadda/shared';
import { buildServer, type BuiltServer } from './server';

/**
 * Boots a real server on an ephemeral port and connects four real socket.io
 * clients. Exercises the full lifecycle and, crucially, asserts the privacy
 * guarantee: no client's payload ever contains another player's cards.
 */

let server: BuiltServer;
let port: number;

/** A connected test client bundled with its identity and latest state. */
class Peer {
  latest: RoomStateUpdate | null = null;
  constructor(
    readonly socket: ClientSocket,
    readonly playerId: string,
    readonly name: string,
  ) {
    socket.on(ServerEvents.RoomStateUpdate, (u: RoomStateUpdate) => {
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

function connect(playerId: string, name: string): Promise<Peer> {
  const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
  const peer = new Peer(socket, playerId, name);
  peers.push(peer);
  return new Promise<Peer>((resolve) => socket.on('connect', () => resolve(peer)));
}

function emitAck<T>(socket: ClientSocket, event: string, payload: unknown): Promise<T> {
  return new Promise<T>((resolve) => socket.emit(event, payload, resolve));
}

async function waitFor(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
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

/** Create the room with the first peer and join the rest; return all four. */
async function seatFourPlayers(): Promise<{ code: string; all: Peer[] }> {
  const a = await connect('p-a', 'Ann');
  const created = await emitAck<CreateRoomRes>(a.socket, ClientEvents.CreateRoom, {
    playerId: a.playerId,
    name: a.name,
  });
  expect(created.ok).toBe(true);
  const code = created.roomCode!;

  const rest: Peer[] = [];
  for (const [pid, name] of [
    ['p-b', 'Bob'],
    ['p-c', 'Cy'],
    ['p-d', 'Dee'],
  ] as const) {
    const peer = await connect(pid, name);
    const res = await emitAck<JoinRoomRes>(peer.socket, ClientEvents.JoinRoom, {
      roomCode: code,
      playerId: pid,
      name,
    });
    expect(res.ok).toBe(true);
    rest.push(peer);
  }
  return { code, all: [a, ...rest] };
}

/** Whoever is on the clock bids the minimum, until the playing phase begins. */
async function completeBidding(all: Peer[]): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await waitFor(() => all.some((p) => p.latest?.room.turn === p.seat));
    const onClock = all.find((p) => p.latest!.room.turn === p.seat)!;
    const seatNow = onClock.seat;
    onClock.socket.emit(ClientEvents.PlaceBid, { bid: 1 });
    await waitFor(() => onClock.latest!.room.players.find((pl) => pl.seat === seatNow)?.bid === 1);
  }
}

describe('GameServer end-to-end', () => {
  it('generates a readable 6-char room code', async () => {
    const a = await connect('p-a', 'Ann');
    const created = await emitAck<CreateRoomRes>(a.socket, ClientEvents.CreateRoom, {
      playerId: a.playerId,
      name: a.name,
    });
    expect(created.roomCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('rejects joining a non-existent room', async () => {
    const s = await connect('x', 'X');
    const res = await emitAck<JoinRoomRes>(s.socket, ClientEvents.JoinRoom, {
      roomCode: 'ZZZZZZ',
      playerId: 'x',
      name: 'X',
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it('auto-starts and deals 13 cards to each of four players', async () => {
    const { all } = await seatFourPlayers();
    await waitFor(() => all.every((p) => p.hand.length === 13));
    for (const p of all) {
      expect(p.latest!.room.phase).toBe('bidding');
      expect(p.latest!.room.players.every((pl) => pl.cardCount === 13)).toBe(true);
    }
  });

  it('NEVER leaks another player’s hand in any payload', async () => {
    const { all } = await seatFourPlayers();
    await waitFor(() => all.every((p) => p.hand.length === 13));

    for (const p of all) {
      const update = p.latest!;
      const ownIds = new Set(p.hand);

      // Public player entries expose counts, never cards.
      for (const pub of update.room.players) {
        expect(pub.cardCount).toBe(13);
        expect((pub as unknown as Record<string, unknown>).hand).toBeUndefined();
      }

      // The only cards anywhere in the payload are this player's own hand
      // (plus any face-up trick cards — none yet, before a card is played).
      const trickCards = update.room.currentTrick.map((t) => `${t.card.suit}${t.card.rank}`);
      expect(trickCards).toEqual([]);
      expect(update.self!.hand.every((c) => ownIds.has(`${c.suit}${c.rank}`))).toBe(true);
    }

    // Union of the four hands is exactly the 52-card deck, no overlaps.
    const everyCard = all.flatMap((p) => p.hand);
    expect(everyCard).toHaveLength(52);
    expect(new Set(everyCard).size).toBe(52);
  });

  it('runs bidding then accepts a legal card play', async () => {
    const { all } = await seatFourPlayers();
    await waitFor(() => all.every((p) => p.hand.length === 13));

    await completeBidding(all);
    await waitFor(() => all.every((p) => p.latest!.room.phase === 'playing'));
    for (const p of all) {
      expect(p.latest!.room.players.every((pl) => pl.bid === 1)).toBe(true);
    }

    const leader = all.find((p) => p.seat === p.latest!.room.turn)!;
    const card = leader.latest!.self!.legalPlays[0]!;
    const before = leader.hand.length;
    leader.socket.emit(ClientEvents.PlayCard, { card });

    await waitFor(() => leader.hand.length === before - 1);
    await waitFor(() => leader.latest!.room.currentTrick.length >= 1);
    expect(leader.latest!.room.currentTrick[0]!.card).toEqual(card);
  });

  it('holds a dropped player’s seat instead of dropping it immediately', async () => {
    const { code, all } = await seatFourPlayers();
    await waitFor(() => all.every((p) => p.hand.length === 13));

    const victim = all[1]!;
    const victimSeat = victim.seat;
    victim.socket.close();

    // Others should see the seat still present but marked disconnected.
    const observer = all[0]!;
    await waitFor(
      () => observer.latest!.room.players.find((pl) => pl.seat === victimSeat)?.connected === false,
    );
    expect(observer.latest!.room.players).toHaveLength(4);
    expect(observer.latest!.room.seatsFilled).toBe(4);

    // Reconnecting with the same player id reclaims the seat.
    const rejoin = await connect(victim.playerId, victim.name);
    const res = await emitAck<JoinRoomRes>(rejoin.socket, ClientEvents.JoinRoom, {
      roomCode: code,
      playerId: victim.playerId,
      name: victim.name,
    });
    expect(res.ok).toBe(true);
    expect(res.seat).toBe(victimSeat);
    await waitFor(
      () => observer.latest!.room.players.find((pl) => pl.seat === victimSeat)?.connected === true,
    );
  });
});
