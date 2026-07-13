import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import { SESSION_TOPUP, STARTING_BALANCE, TEENPATTI_BOOT } from '@cardadda/economy-engine';
import {
  TeenPattiClientEvents,
  TeenPattiServerEvents,
  type TeenPattiCreateRoomRes,
  type TeenPattiGameOverPayload,
  type TeenPattiJoinRoomRes,
  type TeenPattiPlayAgainRes,
  type TeenPattiRoomStateUpdate,
  type TeenPattiSessionSettledPayload,
} from '@cardadda/shared';
import { buildServer, type BuiltServer } from './server';

/**
 * Teen Patti is the only game with a persistent multi-hand SESSION per room
 * (real money — even if virtual — is at stake, so this needs its own
 * server-authoritative coverage the way the other three games already have).
 */

let server: BuiltServer;
let port: number;

class Peer {
  latest: TeenPattiRoomStateUpdate | null = null;
  gameOver: TeenPattiGameOverPayload | null = null;
  sessionSettled: TeenPattiSessionSettledPayload | null = null;
  constructor(
    readonly socket: ClientSocket,
    readonly username: string,
    autoPlay: boolean,
  ) {
    socket.on(TeenPattiServerEvents.RoomStateUpdate, (u: TeenPattiRoomStateUpdate) => {
      this.latest = u;
      // Bots mode always seats the creator at seat 0, and every hand starts
      // with turn 0 — so the real player's OWN turns are never auto-driven
      // by the server's bot AI. To let a full hand run to completion in a
      // test, stand in for a maximally passive human: see immediately, then
      // always just call the legal minimum.
      if (autoPlay && u.self) {
        if (u.self.canSeeCards) socket.emit(TeenPattiClientEvents.SeeCards);
        else if (u.self.canBet && u.self.minBet !== null) socket.emit(TeenPattiClientEvents.Bet, { amount: u.self.minBet });
      }
    });
    socket.on(TeenPattiServerEvents.GameOver, (p: TeenPattiGameOverPayload) => {
      this.gameOver = p;
    });
    socket.on(TeenPattiServerEvents.SessionSettled, (p: TeenPattiSessionSettledPayload) => {
      this.sessionSettled = p;
    });
  }
  get seat(): number {
    return this.latest!.self!.seat;
  }
  get stack(): number {
    return this.latest!.room.players.find((p) => p.seat === this.seat)!.stack;
  }
}

const peers: Peer[] = [];

function connect(username: string, autoPlay = false): Promise<Peer> {
  const socket = ioClient(`http://localhost:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    auth: { token: `dev:${username}` },
  });
  const peer = new Peer(socket, username, autoPlay);
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

const SESSION_BANKROLL = STARTING_BALANCE + SESSION_TOPUP;

describe('TeenPattiGameServer — session/stack economy', () => {
  it('bots mode deals a hand with the boot deducted from every stack, including bots', async () => {
    const a = await connect('Solo');
    const created = await emitAck<TeenPattiCreateRoomRes>(a.socket, TeenPattiClientEvents.CreateRoom, {
      mode: 'bots',
      variant: 'classic',
    });
    expect(created.ok).toBe(true);
    a.socket.emit(TeenPattiClientEvents.JoinRoom, { roomCode: created.roomCode! });

    await waitFor(() => a.latest?.room.phase === 'playing');
    expect(a.latest!.room.players).toHaveLength(4);
    for (const p of a.latest!.room.players) {
      expect(p.stack).toBe(SESSION_BANKROLL - TEENPATTI_BOOT);
    }
    // Self state carries this session's bankroll/threshold context.
    expect(a.latest!.self!.session.bankroll).toBe(SESSION_BANKROLL);
    expect(a.latest!.self!.session.wagered).toBe(TEENPATTI_BOOT);
  });

  it('conserves money end-to-end: the winner receives the full pot, nothing leaks', async () => {
    const a = await connect('Solo2', true);
    const created = await emitAck<TeenPattiCreateRoomRes>(a.socket, TeenPattiClientEvents.CreateRoom, {
      mode: 'bots',
      variant: 'classic',
    });
    a.socket.emit(TeenPattiClientEvents.JoinRoom, { roomCode: created.roomCode! });
    await waitFor(() => a.latest?.room.phase === 'playing');

    await waitFor(() => a.gameOver !== null, 20000);
    const total = a.latest!.room.players.reduce((sum, p) => sum + p.stack, 0);
    expect(total).toBe(4 * SESSION_BANKROLL);
  }, 25000);

  it('deals the next hand in the SAME room via play_again, preserving the session', async () => {
    const a = await connect('Solo3', true);
    const created = await emitAck<TeenPattiCreateRoomRes>(a.socket, TeenPattiClientEvents.CreateRoom, {
      mode: 'bots',
      variant: 'classic',
    });
    const code = created.roomCode!;
    a.socket.emit(TeenPattiClientEvents.JoinRoom, { roomCode: code });
    await waitFor(() => a.latest?.room.phase === 'playing');

    await waitFor(() => a.gameOver !== null, 20000);
    const wageredAfterHand1 = a.latest!.self!.session.wagered;

    // PlayAgain takes no request payload — only an ack — so it's emitted
    // directly rather than through emitAck (which always sends a payload
    // argument; Socket.io would silently treat that as the ack instead).
    const again = await new Promise<TeenPattiPlayAgainRes>((resolve) =>
      a.socket.emit(TeenPattiClientEvents.PlayAgain, resolve),
    );
    expect(again.ok).toBe(true);
    expect(again.roomCode).toBe(code); // same room/session, not a fresh one

    // A fresh hand dealt in the same room/session: this session's cumulative
    // wagered total has grown by at least the new hand's boot. Checked as
    // >=, not ==, and without asserting on `phase` at all — with the test's
    // near-zero bot delay, the second hand can resolve to gameOver again
    // before this poll ever observes it mid-'playing', but `wagered` only
    // ever accumulates, so it reliably proves a second hand was dealt.
    await waitFor(() => a.latest!.self!.session.wagered >= wageredAfterHand1 + TEENPATTI_BOOT);
  }, 25000);

  it('leaving mid-hand settles the session immediately (even before the fold is physically applied), and the table continues for the rest', async () => {
    // Three real players so the table is still viable (>= 2 real) once Bob
    // leaves — with only 2, Bob leaving would correctly end the whole table
    // too (teammates mode has no bots to fall back on), which is a different
    // scenario than "the table continues without the departing player".
    const ann = await connect('Ann');
    const created = await emitAck<TeenPattiCreateRoomRes>(ann.socket, TeenPattiClientEvents.CreateRoom, {
      mode: 'teammates',
      variant: 'classic',
    });
    ann.socket.emit(TeenPattiClientEvents.JoinRoom, { roomCode: created.roomCode! });
    const bob = await connect('Bob');
    await emitAck<TeenPattiJoinRoomRes>(bob.socket, TeenPattiClientEvents.JoinRoom, { roomCode: created.roomCode! });
    const cy = await connect('Cy');
    await emitAck<TeenPattiJoinRoomRes>(cy.socket, TeenPattiClientEvents.JoinRoom, { roomCode: created.roomCode! });

    ann.socket.emit(TeenPattiClientEvents.StartNow);
    await waitFor(() => ann.latest?.room.phase === 'playing');
    expect(ann.seat).toBe(0);
    expect(bob.seat).toBe(1);
    expect(cy.seat).toBe(2);

    const bobStackAtLeave = bob.stack; // bankroll - boot, since nobody has bet yet
    bob.socket.emit(TeenPattiClientEvents.LeaveRoom);

    // Settlement happens right away, independent of when the fold physically lands.
    await waitFor(() => bob.sessionSettled !== null);
    expect(bob.sessionSettled!.endingAmount).toBe(bobStackAtLeave);
    expect(bob.sessionSettled!.newPermanentBalance).toBe(STARTING_BALANCE); // absorbed by the top-up, unchanged

    // The table is still viable (Ann + Cy) — Bob is deferred ("leaving"),
    // still occupying his seat in the live hand, not yet physically removed.
    expect(ann.latest!.room.players).toHaveLength(3);

    // Ann's turn (seat 0) — a min bet advances the turn to Bob's seat, which
    // auto-folds him (he's marked "leaving") before anyone waits on him, and
    // play continues normally between Ann and Cy from there.
    const bounds = { min: ann.latest!.room.currentStake, max: ann.latest!.room.currentStake * 2 };
    ann.socket.emit(TeenPattiClientEvents.Bet, { amount: bounds.min });

    await waitFor(() => ann.latest!.room.players.length === 2);
    const remainingNames = ann.latest!.room.players.map((p) => p.name).sort();
    expect(remainingNames).toEqual(['Ann', 'Cy']);
    await waitFor(() => ann.latest!.room.turn === cy.seat); // it's Cy's turn now, not stuck on the departed Bob

    const bobFinalBalance = await server.wallet.getBalance('dev-bob');
    expect(bobFinalBalance).toBe(STARTING_BALANCE);
  });
});
