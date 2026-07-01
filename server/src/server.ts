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
import { createHistoryStore, type MatchHistoryStore } from './persistence';
import { log } from './logger';

export interface BuiltServer {
  http: HttpServer;
  io: SocketServer;
  game: GameServer;
  store: MatchHistoryStore;
}

export async function buildServer(): Promise<BuiltServer> {
  const store = await createHistoryStore();

  const app = express();
  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: config.corsOrigin, methods: ['GET', 'POST'] },
  });

  const game = new GameServer(io, store);
  io.on('connection', (socket) => game.register(socket));

  // ── HTTP routes ──────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  // Match history for the /history tab, keyed by the browser player id.
  app.get('/api/history', async (req, res) => {
    const playerId = String(req.query.playerId ?? '').trim();
    if (!playerId) {
      res.status(400).json({ error: 'playerId is required' });
      return;
    }
    const limit = Math.min(Number(req.query.limit ?? 25) || 25, 100);
    try {
      const matches = await game.listMatches(playerId, limit);
      res.json({ matches });
    } catch (err) {
      log.error('History query failed', err);
      res.status(500).json({ error: 'Failed to load history' });
    }
  });

  // Lightweight room existence/summary for the join flow's UX.
  app.get('/api/rooms/:code', (req, res) => {
    res.json(game.roomSummary(req.params.code));
  });

  return { http: httpServer, io, game, store };
}
