/**
 * A dedicated file for the disconnect-TIMEOUT path specifically (as opposed
 * to an explicit `leave_room`): an unresponsive drop that never reconnects
 * within the grace window. Per the fixed 31 lifecycle, this must NEVER end
 * the room outright (that's reserved for an explicit, confirmed host Leave)
 * — it's treated exactly like a voluntary departure: eliminated if still
 * alive, match continues.
 *
 * Uses a short `RECONNECT_GRACE_MS` so the timeout actually fires within a
 * fast test. Set via `process.env` BEFORE `buildServer` is imported (dynamic
 * import, since config.ts reads the env once at module load) — isolated to
 * this file only (vitest gives each test file its own module registry), so
 * the other suites keep the real default.
 */
process.env.RECONNECT_GRACE_MS = '150';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import {
  ThirtyOneClientEvents,
  ThirtyOneServerEvents,
  type ThirtyOneCreateRoomRes,
  type ThirtyOneJoinRoomRes,
  type ThirtyOneRoomStateUpdate,
} from '@cardadda/shared';

let buildServer: typeof import('./server').buildServer;
let server: Awaited<ReturnType<typeof buildServer>>;
let port: number;

class Peer {
  latest: ThirtyOneRoomStateUpdate | null = null;
  constructor(readonly socket: ClientSocket, readonly username: string) {
    socket.on(ThirtyOneServerEvents.RoomStateUpdate, (u: ThirtyOneRoomStateUpdate) => {
      this.latest = u;
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

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(async () => {
  ({ buildServer } = await import('./server'));
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

describe('31 disconnect-timeout lifecycle (unresponsive drop, never explicit leave)', () => {
  it('a non-host who never reconnects is eliminated after the grace window — the match continues, never aborts', async () => {
    const a = await connect('Ann');
    const created = await new Promise<ThirtyOneCreateRoomRes>((resolve) =>
      a.socket.emit(ThirtyOneClientEvents.CreateRoom, { mode: 'teammates', teammates: 3 }, resolve),
    );
    a.socket.emit(ThirtyOneClientEvents.JoinRoom, { roomCode: created.roomCode! });
    const others: Peer[] = [];
    for (const name of ['Bob', 'Cy', 'Dee']) {
      const p = await connect(name);
      await emitAck<ThirtyOneJoinRoomRes>(p.socket, ThirtyOneClientEvents.JoinRoom, { roomCode: created.roomCode! });
      others.push(p);
    }
    const all = [a, ...others];
    await waitFor(() => all.every((p) => p.hand.length === 3));

    const victim = others[0]!; // Bob — not the host
    const victimSeat = victim.seat;
    let sawAbortError = false;
    a.socket.on(ThirtyOneServerEvents.ErrorMessage, () => (sawAbortError = true));

    victim.socket.close(); // an unresponsive drop — no leave_room event at all
    await waitFor(() => a.latest!.room.players.find((p) => p.seat === victimSeat)?.connected === false);

    // Wait past the (shortened) grace window without reconnecting.
    await waitFor(() => a.latest!.room.players.find((p) => p.seat === victimSeat)?.eliminated === true, 3000);

    expect(sawAbortError).toBe(false); // never treated as "abort the room"
    expect(a.latest!.room.phase).not.toBe('gameOver'); // 3 players still standing
    expect(a.latest!.room.players).toHaveLength(4); // still present as a spectator record
  });
});
