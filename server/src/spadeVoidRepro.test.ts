import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import type { Card, GameState, Seat } from '@cardadda/engine';
import {
  ClientEvents,
  ServerEvents,
  type CreateRoomRes,
  type JoinRoomRes,
  type RoomStateUpdate,
} from '@cardadda/shared';
import { buildServer, type BuiltServer } from './server';

/**
 * End-to-end reproduction of the reported "spade led while void of spades
 * freezes the game" bug — over real sockets, through the real redaction and
 * validation path, with a deterministically rigged deal.
 */

let server: BuiltServer;
let port: number;

class Peer {
  latest: RoomStateUpdate | null = null;
  errors: string[] = [];
  constructor(readonly socket: ClientSocket, readonly username: string) {
    socket.on(ServerEvents.RoomStateUpdate, (u: RoomStateUpdate) => {
      this.latest = u;
    });
    socket.on(ServerEvents.ErrorMessage, (e: { message: string }) => {
      this.errors.push(e.message);
    });
  }
  get seat(): number {
    return this.latest!.self!.seat;
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

const c = (suit: Card['suit'], rank: Card['rank']): Card => ({ suit, rank });

describe('spade led at a player void of spades (reported freeze)', () => {
  it('the void player receives their ENTIRE hand as legal and can discard any card', async () => {
    // Seat 4 real players.
    const ann = await connect('Ann');
    const created = await emitAck<CreateRoomRes>(ann.socket, ClientEvents.CreateRoom, { mode: 'teammates', teammates: 3 });
    expect(created.ok).toBe(true);
    ann.socket.emit(ClientEvents.JoinRoom, { roomCode: created.roomCode! });
    const rest: Peer[] = [];
    for (const name of ['Bob', 'Cy', 'Dee']) {
      const p = await connect(name);
      const res = await emitAck<JoinRoomRes>(p.socket, ClientEvents.JoinRoom, { roomCode: created.roomCode! });
      expect(res.ok).toBe(true);
      rest.push(p);
    }
    const all = [ann, ...rest];
    await waitFor(() => all.every((p) => (p.latest?.self?.hand.length ?? 0) === 13));

    // Everyone bids 1 → playing phase.
    for (const p of all) p.socket.emit(ClientEvents.PlaceBid, { bid: 1 });
    await waitFor(() => all.every((p) => p.latest?.room.phase === 'playing'));

    // Rig the deal deterministically through the server's own room object:
    // seat(turn) leads and holds spades; the NEXT seat is completely void of
    // spades. Remaining cards don't matter for the scenario.
    const room = (server.game as unknown as { rooms: Map<string, { game: GameState }> }).rooms.get(created.roomCode!)!;
    const game = room.game;
    const leader = game.turn as Seat;
    const next = ((leader + 1) % 4) as Seat;
    const hands: Card[][] = [[], [], [], []];
    hands[leader] = [c('S', 10), c('H', 2), c('D', 2)];
    hands[next] = [c('H', 9), c('D', 7), c('C', 12)]; // VOID of spades
    hands[(leader + 2) % 4] = [c('S', 4), c('C', 2), c('C', 3)];
    hands[(leader + 3) % 4] = [c('S', 5), c('H', 3), c('H', 4)];
    room.game = { ...game, hands, currentTrick: [] };

    const bySeat = new Map<number, Peer>(all.map((p) => [p.seat, p]));
    const leadPeer = bySeat.get(leader)!;
    const voidPeer = bySeat.get(next)!;

    // Leader plays the 10♠ — a spade is now led.
    leadPeer.socket.emit(ClientEvents.PlayCard, { card: c('S', 10) });
    await waitFor(() => voidPeer.latest?.room.turn === next);

    // The reported bug: zero legal cards for the void player. Assert the
    // opposite — the ENTIRE hand must be legal (free discard when void of
    // both the lead suit and trump, which are the same suit here).
    const legal = voidPeer.latest!.self!.legalPlays;
    expect(legal).toHaveLength(3);
    expect(legal).toEqual(expect.arrayContaining([c('H', 9), c('D', 7), c('C', 12)]));

    // And the discard is actually ACCEPTED by the server-side validator.
    voidPeer.socket.emit(ClientEvents.PlayCard, { card: c('C', 12) });
    await waitFor(() => (voidPeer.latest?.room.currentTrick.length ?? 0) === 2);
    expect(voidPeer.errors).toEqual([]); // no "Illegal card" rejection
    expect(voidPeer.latest!.room.turn).toBe((next + 1) % 4); // play moved on — no freeze
  });
});
