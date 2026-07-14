/**
 * Build the HTTP + Socket.io server. Exported as a factory so tests can spin it
 * up on an ephemeral port. The Express layer serves a health check and the
 * match-history read endpoint the /history page calls; realtime gameplay flows
 * over Socket.io.
 */

import { createServer, type Server as HttpServer } from 'node:http';
import express, { type Request } from 'express';
import cors from 'cors';
import { Server as SocketServer } from 'socket.io';
import { config, isAdminUsername } from './config';
import { GameServer } from './gameServer';
import { Crazy8GameServer } from './crazy8GameServer';
import { ThirtyOneGameServer } from './thirtyOneGameServer';
import { TeenPattiGameServer } from './teenPattiGameServer';
import { createHistoryStore, type MatchHistoryStore } from './persistence';
import { createWalletStore, adjustBalance, type WalletStore } from './wallet';
import { createUserDirectory, type UserDirectory } from './users';
import { verifyToken, type Identity } from './auth';
import { log } from './logger';

/** Verify the request's bearer token, or throw. Identity is never client-supplied. */
async function identityFromRequest(req: Request): Promise<Identity> {
  const auth = req.header('authorization') ?? '';
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
  return verifyToken(token);
}

export interface BuiltServer {
  http: HttpServer;
  io: SocketServer;
  game: GameServer;
  crazy8: Crazy8GameServer;
  thirtyOne: ThirtyOneGameServer;
  teenPatti: TeenPattiGameServer;
  store: MatchHistoryStore;
  wallet: WalletStore;
  users: UserDirectory;
}

export async function buildServer(): Promise<BuiltServer> {
  const store = await createHistoryStore();
  const wallet = await createWalletStore();
  const users = await createUserDirectory(wallet);

  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: config.corsOrigin, methods: ['GET', 'POST'] },
  });

  // Authenticate every socket at the handshake: derive a verified identity from
  // the token and stash it on socket.data. Unauthenticated sockets are rejected.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      const identity = await verifyToken(token);
      socket.data.userId = identity.userId;
      socket.data.username = identity.username;
      next();
    } catch (err) {
      next(new Error(err instanceof Error ? err.message : 'Unauthorized'));
    }
  });

  const game = new GameServer(io, store, wallet);
  const crazy8 = new Crazy8GameServer(io, store, wallet);
  const thirtyOne = new ThirtyOneGameServer(io, store, wallet);
  const teenPatti = new TeenPattiGameServer(io, store, wallet);
  // All game handlers attach to every authenticated socket; each listens for
  // its own namespaced event names, so one connection serves every game.
  io.on('connection', (socket) => {
    game.register(socket);
    crazy8.register(socket);
    thirtyOne.register(socket);
    teenPatti.register(socket);
  });

  // ── HTTP routes ──────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  // Match history for the signed-in user. The identity comes from the verified
  // bearer token (Authorization header) — never a client-supplied id.
  app.get('/api/history', async (req, res) => {
    let userId: string;
    try {
      ({ userId } = await identityFromRequest(req));
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const limit = Math.min(Number(req.query.limit ?? 25) || 25, 100);
    try {
      const matches = await game.listMatches(userId, limit);
      res.json({ matches });
    } catch (err) {
      log.error('History query failed', err);
      res.status(500).json({ error: 'Failed to load history' });
    }
  });

  // Persistent wallet balance for the signed-in user (used by the account/
  // header UI and by each table before a session starts). `isAdmin` tells the
  // client whether to show the admin panel; the actual authority check is
  // enforced independently on every /api/admin/* request.
  app.get('/api/wallet', async (req, res) => {
    let identity: Identity;
    try {
      identity = await identityFromRequest(req);
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const balance = await wallet.getBalance(identity.userId);
      res.json({ balance, isAdmin: isAdminUsername(identity.username) });
    } catch (err) {
      log.error('Wallet query failed', err);
      res.status(500).json({ error: 'Failed to load balance' });
    }
  });

  // Public all-time leaderboard: every account ranked by permanent balance,
  // highest first. Only usernames and balances leave the server — no ids.
  app.get('/api/leaderboard', async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit ?? 100) || 100, 500);
      const rows = (await wallet.listBalances()).slice(0, limit);
      const names = await users.resolveUsernames(rows.map((r) => r.userId));
      let rank = 0;
      let prevBalance: number | null = null;
      const entries = rows.map((row, i) => {
        if (row.balance !== prevBalance) {
          rank = i + 1; // tied balances share a rank
          prevBalance = row.balance;
        }
        return { rank, username: names.get(row.userId) ?? row.userId, balance: row.balance };
      });
      res.json({ entries });
    } catch (err) {
      log.error('Leaderboard query failed', err);
      res.status(500).json({ error: 'Failed to load leaderboard' });
    }
  });

  // ── Admin (verified-username gate; see config.adminUsernames) ────────────
  const requireAdmin = async (req: Request): Promise<Identity | null> => {
    const identity = await identityFromRequest(req);
    return isAdminUsername(identity.username) ? identity : null;
  };

  // Username search for the admin add-money flow.
  app.get('/api/admin/users', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      if (!admin) {
        res.status(403).json({ error: 'Admin only' });
        return;
      }
      const q = String(req.query.q ?? '').trim();
      if (!q) {
        res.json({ users: [] });
        return;
      }
      const found = await users.findByUsername(q, 10);
      // Reading each balance also lazily creates missing wallet rows at the
      // starting balance — which backfills accounts that predate wallets.
      const withBalances = await Promise.all(
        found.map(async (u) => ({ username: u.username, balance: await wallet.getBalance(u.userId) })),
      );
      res.json({ users: withBalances });
    } catch (err) {
      log.error('Admin user search failed', err);
      res.status(500).json({ error: 'Search failed' });
    }
  });

  // Credit money to any account (positive amounts only, admin only).
  app.post('/api/admin/add-money', async (req, res) => {
    try {
      const admin = await requireAdmin(req);
      if (!admin) {
        res.status(403).json({ error: 'Admin only' });
        return;
      }
      const username = String(req.body?.username ?? '').trim();
      const amount = Number(req.body?.amount);
      if (!username) {
        res.status(400).json({ error: 'username is required' });
        return;
      }
      if (!Number.isInteger(amount) || amount <= 0 || amount > 10_000_000) {
        res.status(400).json({ error: 'amount must be a whole number between 1 and 1,00,00,000' });
        return;
      }
      const matches = await users.findByUsername(username, 10);
      const target = matches.find((u) => u.username.toLowerCase() === username.toLowerCase());
      if (!target) {
        res.status(404).json({ error: `No user named "${username}"` });
        return;
      }
      const newBalance = await adjustBalance(wallet, target.userId, amount);
      log.info(`Admin ${admin.username} credited ${amount} to ${target.username} (new balance ${newBalance})`);
      res.json({ username: target.username, newBalance });
    } catch (err) {
      log.error('Admin add-money failed', err);
      res.status(500).json({ error: 'Add money failed' });
    }
  });

  // Lightweight room existence/summary for the join flow's UX.
  app.get('/api/rooms/:code', (req, res) => {
    res.json(game.roomSummary(req.params.code));
  });
  app.get('/api/rooms/crazy8/:code', (req, res) => {
    res.json(crazy8.roomSummary(req.params.code));
  });
  app.get('/api/rooms/thirtyone/:code', (req, res) => {
    res.json(thirtyOne.roomSummary(req.params.code));
  });
  app.get('/api/rooms/teenpatti/:code', (req, res) => {
    res.json(teenPatti.roomSummary(req.params.code));
  });

  return { http: httpServer, io, game, crazy8, thirtyOne, teenPatti, store, wallet, users };
}
