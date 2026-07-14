/**
 * Username directory: turns wallet user ids into display names (for the
 * leaderboard) and usernames back into user ids (for the admin add-money
 * flow). Same dual-backend pattern as wallet.ts/persistence.ts:
 *
 *   • Supabase: usernames live in `profiles` (id = auth.users uuid). Dev-mode
 *     synthetic ids (`dev-<slug>`) have no profile row, so those fall back to
 *     the slug itself.
 *   • In-memory (no credentials): every id is `dev-<slug>`; the name IS the
 *     slug, and "search" filters the ids the wallet store already knows.
 */

import { config, hasSupabase } from './config';
import { log } from './logger';
import type { WalletStore } from './wallet';

export interface DirectoryUser {
  userId: string;
  username: string;
}

export interface UserDirectory {
  /** Best-effort display names for a set of user ids (missing ids fall back to a derived name). */
  resolveUsernames(ids: string[]): Promise<Map<string, string>>;
  /** Case-insensitive substring search over registered usernames. */
  findByUsername(query: string, limit: number): Promise<DirectoryUser[]>;
}

/** `dev-<slug>` → `<slug>`; anything else is returned unchanged. */
function nameFromDevId(id: string): string {
  return id.startsWith('dev-') ? id.slice(4) : id;
}

class DevUserDirectory implements UserDirectory {
  constructor(private readonly wallet: WalletStore) {}

  async resolveUsernames(ids: string[]): Promise<Map<string, string>> {
    return new Map(ids.map((id) => [id, nameFromDevId(id)]));
  }

  async findByUsername(query: string, limit: number): Promise<DirectoryUser[]> {
    const q = query.trim().toLowerCase();
    const rows = await this.wallet.listBalances();
    return rows
      .map((r) => ({ userId: r.userId, username: nameFromDevId(r.userId) }))
      .filter((u) => u.username.toLowerCase().includes(q))
      .slice(0, limit);
  }
}

class SupabaseUserDirectory implements UserDirectory {
  // Typed loosely to avoid a hard compile-time dependency on the client's generics.
  private client: any;

  constructor(url: string, key: string, createClient: (u: string, k: string) => unknown) {
    this.client = createClient(url, key);
  }

  async resolveUsernames(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>(ids.map((id) => [id, nameFromDevId(id)]));
    const profileIds = ids.filter((id) => !id.startsWith('dev-'));
    if (profileIds.length === 0) return out;

    const { data, error } = await this.client
      .from('profiles')
      .select('id, username')
      .in('id', profileIds);
    if (error) throw new Error(`Supabase profiles lookup failed: ${error.message}`);
    for (const row of data ?? []) out.set(String(row.id), String(row.username));
    return out;
  }

  async findByUsername(query: string, limit: number): Promise<DirectoryUser[]> {
    // Escape ilike wildcards so the query is a literal substring match.
    const escaped = query.trim().replace(/[%_\\]/g, '\\$&');
    const { data, error } = await this.client
      .from('profiles')
      .select('id, username')
      .ilike('username', `%${escaped}%`)
      .order('username')
      .limit(limit);
    if (error) throw new Error(`Supabase profiles search failed: ${error.message}`);
    return (data ?? []).map((r: any) => ({ userId: String(r.id), username: String(r.username) }));
  }
}

/** Build the appropriate directory (mirrors createWalletStore's backend choice). */
export async function createUserDirectory(wallet: WalletStore): Promise<UserDirectory> {
  if (!hasSupabase()) return new DevUserDirectory(wallet);
  try {
    const { createClient } = await import('@supabase/supabase-js');
    return new SupabaseUserDirectory(config.supabaseUrl, config.supabaseKey, createClient as never);
  } catch (err) {
    log.error('Users: failed to init Supabase directory, falling back to dev directory.', err);
    return new DevUserDirectory(wallet);
  }
}
