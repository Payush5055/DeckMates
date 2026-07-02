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
    readonly username: string,
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

/** Connect with a dev-auth handshake token (server runs with DEV_AUTH=1). */
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

/** create_room now takes a mode payload. Defaults to a full 4-real-player table. */
function createRoom(
  socket: ClientSocket,
  req: { mode: 'bots' | 'teammates'; teammates?: number } = { mode: 'teammates', teammates: 3 },
): Promise<CreateRoomRes> {
  return new Promise<CreateRoomRes>((resolve) => socket.emit(ClientEvents.CreateRoom, req, resolve));
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
  const a = await connect('Ann');
  const created = await createRoom(a.socket);
  expect(created.ok).toBe(true);
  const code = created.roomCode!;

  const rest: Peer[] = [];
  for (const name of ['Bob', 'Cy', 'Dee']) {
    const peer = await connect(name);
    const res = await emitAck<JoinRoomRes>(peer.socket, ClientEvents.JoinRoom, { roomCode: code });
    expect(res.ok).toBe(true);
    rest.push(peer);
  }
  return { code, all: [a, ...rest] };
}

/** Bidding is simultaneous: every player submits, then we wait for playing. */
async function completeBidding(all: Peer[]): Promise<void> {
  for (const p of all) p.socket.emit(ClientEvents.PlaceBid, { bid: 1 });
  await waitFor(() => all.every((p) => p.latest!.room.phase === 'playing'));
}

describe('GameServer end-to-end', () => {
  it('generates a readable 6-char room code', async () => {
    const a = await connect('Ann');
    const created = await createRoom(a.socket);
    expect(created.roomCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('rejects joining a non-existent room', async () => {
    const s = await connect('X');
    const res = await emitAck<JoinRoomRes>(s.socket, ClientEvents.JoinRoom, { roomCode: 'ZZZZZZ' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it('rejects a socket with no auth token', async () => {
    const socket = ioClient(`http://localhost:${port}`, { transports: ['websocket'], forceNew: true });
    const err = await new Promise<string>((resolve) => {
      socket.on('connect_error', (e) => resolve(e.message));
    });
    socket.close();
    expect(err).toMatch(/token|unauthor/i);
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

  it('keeps bids blind until all four are in, then reveals', async () => {
    const { all } = await seatFourPlayers();
    await waitFor(() => all.every((p) => p.hand.length === 13));

    // Three players bid; the 4th has not.
    all[0]!.socket.emit(ClientEvents.PlaceBid, { bid: 3 });
    all[1]!.socket.emit(ClientEvents.PlaceBid, { bid: 5 });
    all[2]!.socket.emit(ClientEvents.PlaceBid, { bid: 2 });
    await waitFor(() => all[3]!.latest!.room.players.filter((pl) => pl.hasBid).length === 3);

    // Still bidding: NO bid value is visible to anyone, but hasBid is truthful.
    const mid = all[3]!.latest!.room;
    expect(mid.phase).toBe('bidding');
    expect(mid.players.every((pl) => pl.bid === null)).toBe(true);
    // A player can still see their OWN bid via self.
    expect(all[0]!.latest!.self!.bid).toBe(3);
    expect(all[3]!.latest!.self!.bid).toBeNull();

    // Fourth bid → reveal everyone's values at once.
    all[3]!.socket.emit(ClientEvents.PlaceBid, { bid: 4 });
    await waitFor(() => all[0]!.latest!.room.phase === 'playing');
    const bidsBySeat = new Map<number, number | null>(
      all[0]!.latest!.room.players.map((pl) => [pl.seat as number, pl.bid]),
    );
    expect(bidsBySeat.get(all[0]!.seat)).toBe(3);
    expect(bidsBySeat.get(all[1]!.seat)).toBe(5);
    expect(bidsBySeat.get(all[2]!.seat)).toBe(2);
    expect(bidsBySeat.get(all[3]!.seat)).toBe(4);
  });

  it('bots mode fills the table with bots that bid and play', async () => {
    const a = await connect('Solo');
    const created = await createRoom(a.socket, { mode: 'bots' });
    expect(created.ok).toBe(true);
    a.socket.emit(ClientEvents.JoinRoom, { roomCode: created.roomCode! });

    // Table auto-fills: 1 real + 3 bots, dealt in immediately.
    await waitFor(() => a.hand.length === 13, 8000);
    const players = a.latest!.room.players;
    expect(players.filter((pl) => pl.isBot).length).toBe(3);
    expect(players.find((pl) => pl.seat === a.seat)!.isBot).toBe(false);

    // Human bids; bots bid on their own → playing.
    a.socket.emit(ClientEvents.PlaceBid, { bid: 2 });
    await waitFor(() => a.latest!.room.phase === 'playing', 10000);

    // Bots lead/play until it's the human's turn — proves they act autonomously.
    await waitFor(() => a.latest!.room.turn === a.seat, 12000);
    expect(a.latest!.room.currentTrick.length).toBe(3);
  }, 20000); // bots pause 0.8–1.5s per action, so allow generous time

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

  it('broadcasts the completed 4-card trick and holds it before resolving (4th-card fix)', async () => {
    const { all } = await seatFourPlayers();
    await waitFor(() => all.every((p) => p.hand.length === 13));
    await completeBidding(all);
    await waitFor(() => all.every((p) => p.latest!.room.phase === 'playing'));

    // Record the maximum trick size each client ever observes.
    const maxTrickSeen = new Map<Peer, number>();
    for (const p of all) {
      maxTrickSeen.set(p, 0);
      p.socket.on(ServerEvents.RoomStateUpdate, (u: RoomStateUpdate) => {
        maxTrickSeen.set(p, Math.max(maxTrickSeen.get(p)!, u.room.currentTrick.length));
      });
    }

    // Play one full trick: whoever is on the clock plays their first legal card.
    for (let i = 0; i < 4; i++) {
      await waitFor(() => all.some((p) => p.latest!.room.turn === p.seat));
      const onClock = all.find((p) => p.latest!.room.turn === p.seat)!;
      const before = onClock.hand.length;
      onClock.socket.emit(ClientEvents.PlayCard, { card: onClock.latest!.self!.legalPlays[0]! });
      await waitFor(() => onClock.hand.length === before - 1);
    }

    // Every client must have SEEN the all-4-cards state (this was the bug).
    await waitFor(() => all.every((p) => maxTrickSeen.get(p)! === 4));
    // During the hold nobody is on the clock.
    expect(all[0]!.latest!.room.turn).toBeNull();
    expect(all[0]!.latest!.room.players.reduce((n, pl) => n + pl.tricksWon, 0)).toBe(0);

    // After the hold (TRICK_HOLD_MS=80 in tests) the trick resolves: pile
    // cleared, exactly one trick awarded, winner on the clock.
    await waitFor(() => all[0]!.latest!.room.currentTrick.length === 0);
    await waitFor(
      () => all[0]!.latest!.room.players.reduce((n, pl) => n + pl.tricksWon, 0) === 1,
    );
    expect(all[0]!.latest!.room.turn).not.toBeNull();
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

    // Reconnecting as the same user (same dev token) reclaims the seat.
    const rejoin = await connect(victim.username);
    const res = await emitAck<JoinRoomRes>(rejoin.socket, ClientEvents.JoinRoom, { roomCode: code });
    expect(res.ok).toBe(true);
    expect(res.seat).toBe(victimSeat);
    await waitFor(
      () => observer.latest!.room.players.find((pl) => pl.seat === victimSeat)?.connected === true,
    );
  });
});
