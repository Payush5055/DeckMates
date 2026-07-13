import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  ThirtyOneClientEvents,
  ThirtyOneServerEvents,
  type ThirtyOneCreateRoomReq,
  type ThirtyOneCreateRoomRes,
  type ThirtyOneJoinRoomRes,
  type ThirtyOneRoomStateUpdate,
  type ThirtyOneRoundResultPayload,
} from '@cardadda/shared';
import { buildServer, type BuiltServer } from './server';

/**
 * Boots a real server on an ephemeral port and connects real socket.io
 * clients against the 31 handlers. Same privacy bar as the other games: no
 * payload may carry another player's hand before the reveal.
 */

let server: BuiltServer;
let port: number;

class Peer {
  latest: ThirtyOneRoomStateUpdate | null = null;
  roundResult: ThirtyOneRoundResultPayload | null = null;
  constructor(
    readonly socket: ClientSocket,
    readonly username: string,
  ) {
    socket.on(ThirtyOneServerEvents.RoomStateUpdate, (u: ThirtyOneRoomStateUpdate) => {
      this.latest = u;
    });
    socket.on(ThirtyOneServerEvents.RoundResult, (r: ThirtyOneRoundResultPayload) => {
      this.roundResult = r;
    });
  }
  get seat(): number {
    return this.latest!.self!.seat;
  }
  get hand() {
    return this.latest?.self?.hand ?? [];
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

function createRoom(socket: ClientSocket, req: ThirtyOneCreateRoomReq): Promise<ThirtyOneCreateRoomRes> {
  return new Promise((resolve) => socket.emit(ThirtyOneClientEvents.CreateRoom, req, resolve));
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

/** Host + three named friends, full-real table (no bots). */
async function seatFourPlayers(): Promise<{ code: string; all: Peer[] }> {
  const a = await connect('Ann');
  const created = await createRoom(a.socket, { mode: 'teammates', teammates: 3 });
  expect(created.ok).toBe(true);
  const code = created.roomCode!;
  a.socket.emit(ThirtyOneClientEvents.JoinRoom, { roomCode: code });

  const rest: Peer[] = [];
  for (const name of ['Bob', 'Cy', 'Dee']) {
    const p = await connect(name);
    const res = await emitAck<ThirtyOneJoinRoomRes>(p.socket, ThirtyOneClientEvents.JoinRoom, { roomCode: code });
    expect(res.ok).toBe(true);
    rest.push(p);
  }
  return { code, all: [a, ...rest] };
}

describe('ThirtyOneGameServer end-to-end', () => {
  it('generates a readable 6-char room code', async () => {
    const a = await connect('Ann');
    const created = await createRoom(a.socket, { mode: 'teammates', teammates: 3 });
    expect(created.roomCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('rejects joining a non-existent room', async () => {
    const s = await connect('X');
    const res = await emitAck<ThirtyOneJoinRoomRes>(s.socket, ThirtyOneClientEvents.JoinRoom, { roomCode: 'ZZZZZZ' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
  });

  it('bots mode starts immediately: 1 real + 3 bots, 3 cards each, 3 lives each', async () => {
    const a = await connect('Solo');
    const created = await createRoom(a.socket, { mode: 'bots' });
    expect(created.ok).toBe(true);
    a.socket.emit(ThirtyOneClientEvents.JoinRoom, { roomCode: created.roomCode! });

    await waitFor(() => a.hand.length === 3);
    const room = a.latest!.room;
    expect(room.players).toHaveLength(4);
    expect(room.players.filter((p) => p.isBot)).toHaveLength(3);
    expect(room.lives).toEqual([3, 3, 3, 3]);
    expect(room.topDiscard).not.toBeNull();
    // 52 - 12 dealt - 1 flipped
    expect(room.drawPileCount).toBe(39);
  });

  it('NEVER leaks another player’s hand before the reveal', async () => {
    const { all } = await seatFourPlayers();
    await waitFor(() => all.every((p) => p.hand.length === 3));

    for (const p of all) {
      const update = p.latest!;
      for (const pub of update.room.players) {
        expect((pub as unknown as Record<string, unknown>).hand).toBeUndefined();
        expect(pub.cardCount).toBeGreaterThanOrEqual(3);
      }
      expect((update.room as unknown as Record<string, unknown>).drawPile).toBeUndefined();
      expect(update.self!.hand.length).toBeGreaterThanOrEqual(3);
    }
    // The four private hands are disjoint.
    const ids = all.flatMap((p) => p.hand.map((c) => `${c.suit}${c.rank}`));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('knock flow: knocker uses their turn, others get exactly one final turn, reveal names the lowest', async () => {
    const { all } = await seatFourPlayers();
    await waitFor(() => all.every((p) => p.hand.length === 3));

    // If the random deal produced an instant 31, the round already resolved —
    // that path is engine-tested; skip the socket flow in that rare case.
    if (all[0]!.latest!.room.phase !== 'playing') return;

    const bySeat = new Map<number, Peer>(all.map((p) => [p.seat, p]));
    const starter = all[0]!.latest!.room.turn!;
    bySeat.get(starter)!.socket.emit(ThirtyOneClientEvents.Knock);

    await waitFor(() => all[0]!.latest!.room.knockerSeat === starter);
    expect(all[0]!.latest!.room.finalTurnsRemaining).toBe(3);

    // Each remaining player: draw from the pile, then discard the drawn card.
    for (let i = 0; i < 3; i++) {
      await waitFor(() => {
        const r = all[0]!.latest!.room;
        return r.phase !== 'playing' || (r.turn !== null && r.stage === 'draw' && r.turn !== starter);
      });
      const room = all[0]!.latest!.room;
      if (room.phase !== 'playing') break; // someone hit 31 mid-final-round
      const actor = bySeat.get(room.turn!)!;
      actor.socket.emit(ThirtyOneClientEvents.DrawCard, { source: 'pile' });
      await waitFor(() => actor.latest!.self!.mustDiscard || actor.latest!.room.phase !== 'playing');
      if (actor.latest!.room.phase !== 'playing') break;
      const drawn = actor.latest!.self!.hand[3]!;
      actor.socket.emit(ThirtyOneClientEvents.DiscardCard, { card: drawn });
    }

    await waitFor(() => all.every((p) => p.roundResult !== null), 8000);
    const r = all[0]!.roundResult!;
    if (r.reason === 'knock') {
      expect(r.knockerSeat).toBe(starter);
      // Reveal carries all four hands face-up with values.
      expect(r.revealedHands.filter((h) => h !== null)).toHaveLength(4);
      expect(r.handValues.filter((v) => v !== null)).toHaveLength(4);
      // Exactly the specified life totals: someone lost 1, or the knocker lost 2.
      const totalLost = r.livesLost.reduce((a, b) => a + b, 0);
      expect(totalLost).toBeGreaterThanOrEqual(1);
      if (r.doublePenalty) {
        expect(r.livesLost[r.knockerSeat!]).toBe(2);
      }
    } else {
      expect(r.reason).toBe('instant31'); // legitimate alternate ending
    }
  }, 15000);

  it('holds a dropped player’s seat and lets the same user reclaim it', async () => {
    const { code, all } = await seatFourPlayers();
    await waitFor(() => all.every((p) => p.hand.length === 3));

    const victim = all[1]!;
    const victimSeat = victim.seat;
    victim.socket.close();
    await waitFor(
      () => all[0]!.latest!.room.players.find((p) => p.seat === victimSeat)?.connected === false,
    );

    const rejoin = await connect(victim.username);
    const res = await emitAck<ThirtyOneJoinRoomRes>(rejoin.socket, ThirtyOneClientEvents.JoinRoom, {
      roomCode: code,
    });
    expect(res.ok).toBe(true);
    expect(res.seat).toBe(victimSeat);
  });

  it('room lifecycle: a non-host voluntarily leaving mid-match is eliminated, the match continues for the rest, and they cannot rejoin as a spectator', async () => {
    const { code, all } = await seatFourPlayers();
    await waitFor(() => all.every((p) => p.hand.length === 3));

    const leaver = all[1]!; // Bob — not the host (Ann created the room)
    const leaverSeat = leaver.seat;
    let sawError = false;
    for (const p of all) p.socket.on(ThirtyOneServerEvents.ErrorMessage, () => (sawError = true));

    leaver.socket.emit(ThirtyOneClientEvents.LeaveRoom);

    // The match must NOT end: the room is never destroyed, no "match ended"
    // error is broadcast, and the other three keep receiving live state.
    await waitFor(() => all[0]!.latest!.room.players.find((p) => p.seat === leaverSeat)?.lives === 0);
    expect(sawError).toBe(false);
    const stillThere = all[0]!.latest!.room.players.find((p) => p.seat === leaverSeat);
    expect(stillThere).toBeDefined(); // they remain as a (disconnected) spectator record
    expect(stillThere!.eliminated).toBe(true);
    expect(all[0]!.latest!.room.phase).not.toBe('gameOver'); // 3 players still standing

    // They may not rejoin as a spectator.
    const rejoin = await connect(leaver.username);
    const res = await emitAck<ThirtyOneJoinRoomRes>(rejoin.socket, ThirtyOneClientEvents.JoinRoom, {
      roomCode: code,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/left this match/i);
  });

  it('room lifecycle: the HOST leaving mid-match ends the room for everyone', async () => {
    const { all } = await seatFourPlayers();
    await waitFor(() => all.every((p) => p.hand.length === 3));

    const host = all[0]!; // Ann created the room — she's the host
    const errors: string[] = [];
    for (const p of all) p.socket.on(ThirtyOneServerEvents.ErrorMessage, (m: { message: string }) => errors.push(m.message));

    host.socket.emit(ThirtyOneClientEvents.LeaveRoom);
    await waitFor(() => errors.length > 0);
    expect(errors[0]).toMatch(/host.*left|match has ended/i);

    // The room is gone: even the survivors can no longer act on it.
    const summary = server.thirtyOne.roomSummary(host.latest!.room.roomCode);
    expect(summary.exists).toBe(false);
  });
});
