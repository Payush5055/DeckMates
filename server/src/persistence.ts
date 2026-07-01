/**
 * Match-history persistence, behind a small interface so the game runs with or
 * without Supabase. In dev (no keys) we use an in-memory store; when Supabase
 * credentials are present we persist to the `matches` table.
 *
 * See supabase/schema.sql for the table definition.
 */

import type { MatchRecord } from '@cardadda/shared';
import { config, hasSupabase } from './config';
import { log } from './logger';

export interface MatchHistoryStore {
  saveMatch(record: MatchRecord): Promise<void>;
  listMatchesForPlayer(playerId: string, limit: number): Promise<MatchRecord[]>;
}

/** Volatile store — data lives only for the server process lifetime. */
class InMemoryStore implements MatchHistoryStore {
  private matches: MatchRecord[] = [];

  async saveMatch(record: MatchRecord): Promise<void> {
    this.matches.unshift({ ...record, id: record.id ?? cryptoRandomId() });
  }

  async listMatchesForPlayer(playerId: string, limit: number): Promise<MatchRecord[]> {
    return this.matches
      .filter((m) => m.players.some((p) => p.playerId === playerId))
      .slice(0, limit);
  }
}

/**
 * Supabase-backed store. Rows carry a denormalized `player_ids` text[] so we can
 * cheaply query "matches this player was in" with a GIN index.
 */
class SupabaseStore implements MatchHistoryStore {
  // Typed loosely to avoid a hard compile-time dependency on the client's generics.
  private client: any;

  constructor(url: string, key: string, createClient: (u: string, k: string) => unknown) {
    this.client = createClient(url, key);
  }

  async saveMatch(record: MatchRecord): Promise<void> {
    const row = {
      room_code: record.roomCode,
      played_at: record.playedAt,
      player_ids: record.players.map((p) => p.playerId),
      players: record.players,
      rounds: record.rounds,
    };
    const { error } = await this.client.from('matches').insert(row);
    if (error) throw new Error(`Supabase insert failed: ${error.message}`);
  }

  async listMatchesForPlayer(playerId: string, limit: number): Promise<MatchRecord[]> {
    const { data, error } = await this.client
      .from('matches')
      .select('*')
      .contains('player_ids', [playerId])
      .order('played_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Supabase query failed: ${error.message}`);
    return (data ?? []).map(
      (r: any): MatchRecord => ({
        id: r.id,
        roomCode: r.room_code,
        playedAt: r.played_at,
        players: r.players,
        rounds: r.rounds,
      }),
    );
  }
}

function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Build the appropriate store. Supabase is imported lazily so its absence never
 * breaks local dev. Returns the in-memory store when credentials are missing.
 */
export async function createHistoryStore(): Promise<MatchHistoryStore> {
  if (!hasSupabase()) {
    log.info('History: using in-memory store (no Supabase credentials configured).');
    return new InMemoryStore();
  }
  try {
    const { createClient } = await import('@supabase/supabase-js');
    log.info('History: using Supabase store.');
    return new SupabaseStore(config.supabaseUrl, config.supabaseKey, createClient as never);
  } catch (err) {
    log.error('History: failed to init Supabase, falling back to in-memory.', err);
    return new InMemoryStore();
  }
}
