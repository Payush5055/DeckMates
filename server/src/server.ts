/**
 * Build the HTTP + Socket.io server. Exported as a factory so tests can spin it
 * up on an ephemeral port. The Express layer serves a health check and the
 * match-history read endpoint the /history page calls; realtime gameplay flows
 * over Socket.io.
 */

import { createServer, type Server as HttpServer } from 'node:http';
import express from 'express';
import cors from 'cors';
import { Server as SocketServer } from 'socket.io';
import { config } from './config';
import { GameServer } from './gameServer';
import { Crazy8GameServer } from './crazy8GameServer';
import { ThirtyOneGameServer } from './thirtyOneGameServer';
import { TeenPattiGameServer } from './teenPattiGameServer';
import { createHistoryStore, type MatchHistoryStore } from './persistence';
import { createWalletStore, type WalletStore } from './wallet';
import { verifyToken } from './auth';
import { log } from './logger';

export interface BuiltServer {
  http: HttpServer;
  io: SocketServer;
  game: GameServer;
  crazy8: Crazy8GameServer;
  thirtyOne: ThirtyOneGameServer;
  teenPatti: TeenPattiGameServer;
  store: MatchHistoryStore;
  wallet: WalletStore;
}

export async function buildServer(): Promise<BuiltServer> {
  const store = await createHistoryStore();
  const wallet = await createWalletStore();

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
    const auth = req.header('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    let userId: string;
    try {
      ({ userId } = await verifyToken(token));
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
  // header UI and by each table before a session starts).
  app.get('/api/wallet', async (req, res) => {
    const auth = req.header('authorization') ?? '';
    const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
    let userId: string;
    try {
      ({ userId } = await verifyToken(token));
    } catch {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    try {
      const balance = await wallet.getBalance(userId);
      res.json({ balance });
    } catch (err) {
      log.error('Wallet query failed', err);
      res.status(500).json({ error: 'Failed to load balance' });
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

  return { http: httpServer, io, game, crazy8, thirtyOne, teenPatti, store, wallet };
}
