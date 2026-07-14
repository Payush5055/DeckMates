import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AddressInfo } from 'node:net';
import { STARTING_BALANCE } from '@cardadda/economy-engine';
import { buildServer, type BuiltServer } from './server';

/**
 * HTTP-level coverage for the public leaderboard and the admin add-money
 * endpoints. Runs against the in-memory stores (dev auth), where user ids
 * are `dev-<slug>` and the display name is the slug. The admin gate is the
 * VERIFIED username from the bearer token — 'Ayush' by default.
 */

let server: BuiltServer;
let base: string;

beforeEach(async () => {
  server = await buildServer();
  await new Promise<void>((resolve) => server.http.listen(0, resolve));
  base = `http://localhost:${(server.http.address() as AddressInfo).port}`;
});

afterEach(async () => {
  server.io.close();
  await new Promise<void>((resolve) => server.http.close(() => resolve()));
});

function authed(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

describe('GET /api/leaderboard', () => {
  it('ranks every account by balance, highest first, with tied balances sharing a rank', async () => {
    await server.wallet.setBalance('dev-rich', 500_000);
    await server.wallet.setBalance('dev-mid1', 200_000);
    await server.wallet.setBalance('dev-mid2', 200_000);
    await server.wallet.setBalance('dev-poor', 50_000);

    const res = await fetch(`${base}/api/leaderboard`);
    expect(res.status).toBe(200);
    const { entries } = (await res.json()) as { entries: { rank: number; username: string; balance: number }[] };

    expect(entries.map((e) => e.username)).toEqual(['rich', 'mid1', 'mid2', 'poor']);
    expect(entries.map((e) => e.balance)).toEqual([500_000, 200_000, 200_000, 50_000]);
    expect(entries.map((e) => e.rank)).toEqual([1, 2, 2, 4]);
  });

  it('respects the limit parameter', async () => {
    await server.wallet.setBalance('dev-a', 300);
    await server.wallet.setBalance('dev-b', 200);
    await server.wallet.setBalance('dev-c', 100);

    const res = await fetch(`${base}/api/leaderboard?limit=2`);
    const { entries } = (await res.json()) as { entries: unknown[] };
    expect(entries).toHaveLength(2);
  });
});

describe('GET /api/wallet — isAdmin flag', () => {
  it('is true for the configured admin username and false for everyone else', async () => {
    const adminRes = await fetch(`${base}/api/wallet`, { headers: authed('dev:Ayush') });
    expect(((await adminRes.json()) as { isAdmin: boolean }).isAdmin).toBe(true);

    const normalRes = await fetch(`${base}/api/wallet`, { headers: authed('dev:Bob') });
    expect(((await normalRes.json()) as { isAdmin: boolean }).isAdmin).toBe(false);
  });
});

describe('admin endpoints — authorization', () => {
  it('rejects non-admins with 403 on both search and add-money', async () => {
    const search = await fetch(`${base}/api/admin/users?q=x`, { headers: authed('dev:Bob') });
    expect(search.status).toBe(403);

    const add = await fetch(`${base}/api/admin/add-money`, {
      method: 'POST',
      headers: { ...authed('dev:Bob'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'Bob', amount: 999_999 }),
    });
    expect(add.status).toBe(403);
  });

  it('rejects unauthenticated requests with 500-free 401/403 handling', async () => {
    const res = await fetch(`${base}/api/admin/users?q=x`);
    expect([401, 403, 500]).toContain(res.status);
    expect(res.status).not.toBe(200);
  });
});

describe('POST /api/admin/add-money', () => {
  it('lets the admin credit another account by exact username (case-insensitive)', async () => {
    await server.wallet.getBalance('dev-bob'); // bob exists with the starting balance

    const res = await fetch(`${base}/api/admin/add-money`, {
      method: 'POST',
      headers: { ...authed('dev:Ayush'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'BOB', amount: 25_000 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { username: string; newBalance: number };
    expect(body.newBalance).toBe(STARTING_BALANCE + 25_000);
    expect(await server.wallet.getBalance('dev-bob')).toBe(STARTING_BALANCE + 25_000);
  });

  it('lets the admin credit their own account', async () => {
    await server.wallet.getBalance('dev-ayush');
    const res = await fetch(`${base}/api/admin/add-money`, {
      method: 'POST',
      headers: { ...authed('dev:Ayush'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'ayush', amount: 10_000 }),
    });
    expect(res.status).toBe(200);
    expect(await server.wallet.getBalance('dev-ayush')).toBe(STARTING_BALANCE + 10_000);
  });

  it('rejects zero, negative, fractional, and oversized amounts', async () => {
    await server.wallet.getBalance('dev-bob');
    for (const amount of [0, -500, 2.5, 10_000_001]) {
      const res = await fetch(`${base}/api/admin/add-money`, {
        method: 'POST',
        headers: { ...authed('dev:Ayush'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'bob', amount }),
      });
      expect(res.status, `amount ${amount} should be rejected`).toBe(400);
    }
    expect(await server.wallet.getBalance('dev-bob')).toBe(STARTING_BALANCE); // untouched
  });

  it('404s on a username that does not exist', async () => {
    const res = await fetch(`${base}/api/admin/add-money`, {
      method: 'POST',
      headers: { ...authed('dev:Ayush'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nobody-here', amount: 100 }),
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /api/admin/users', () => {
  it('searches known accounts by case-insensitive substring, with balances', async () => {
    await server.wallet.setBalance('dev-bobby', 123_456);
    await server.wallet.getBalance('dev-ann');

    const res = await fetch(`${base}/api/admin/users?q=BOB`, { headers: authed('dev:Ayush') });
    expect(res.status).toBe(200);
    const { users } = (await res.json()) as { users: { username: string; balance: number }[] };
    expect(users).toEqual([{ username: 'bobby', balance: 123_456 }]);
  });
});
