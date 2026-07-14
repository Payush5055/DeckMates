/**
 * Persistent per-user wallet (permanent virtual-money balance), behind a
 * small interface so the game runs with or without Supabase — same pattern as
 * persistence.ts's match-history store. In dev (no keys) we use an in-memory
 * store; when Supabase credentials are present we persist to the `wallets`
 * table. See supabase/schema.sql for the table definition.
 *
 * `user_id` is a plain text primary key (not a Supabase-auth foreign key) so
 * dev/bot synthetic ids (`dev-ann`, `bot-1`, …) work identically to how
 * `matches.player_ids` is handled — bots never get a wallet row at all since
 * only real (non-bot) player ids are ever passed in here.
 */

import { STARTING_BALANCE } from '@cardadda/economy-engine';
import { config, hasSupabase } from './config';
import { log } from './logger';

export interface WalletBalanceRow {
  userId: string;
  balance: number;
}

export interface WalletStore {
  /** Returns the user's permanent balance, creating the account at STARTING_BALANCE if new. */
  getBalance(userId: string): Promise<number>;
  /** Persists a new permanent balance for the user. */
  setBalance(userId: string, balance: number): Promise<void>;
  /** Every known balance, sorted highest first (leaderboard order). */
  listBalances(): Promise<WalletBalanceRow[]>;
}

/** Read-modify-write helper: adjust a balance by a signed delta, returning the new value. */
export async function adjustBalance(store: WalletStore, userId: string, delta: number): Promise<number> {
  const current = await store.getBalance(userId);
  const next = current + delta;
  await store.setBalance(userId, next);
  return next;
}

/** Volatile store — data lives only for the server process lifetime. */
class InMemoryWalletStore implements WalletStore {
  private balances = new Map<string, number>();

  async getBalance(userId: string): Promise<number> {
    if (!this.balances.has(userId)) this.balances.set(userId, STARTING_BALANCE);
    return this.balances.get(userId)!;
  }

  async setBalance(userId: string, balance: number): Promise<void> {
    this.balances.set(userId, balance);
  }

  async listBalances(): Promise<WalletBalanceRow[]> {
    return [...this.balances.entries()]
      .map(([userId, balance]) => ({ userId, balance }))
      .sort((a, b) => b.balance - a.balance);
  }
}

/** Supabase-backed store — one row per user in the `wallets` table. */
class SupabaseWalletStore implements WalletStore {
  // Typed loosely to avoid a hard compile-time dependency on the client's generics.
  private client: any;

  constructor(url: string, key: string, createClient: (u: string, k: string) => unknown) {
    this.client = createClient(url, key);
  }

  async getBalance(userId: string): Promise<number> {
    const { data, error } = await this.client
      .from('wallets')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(`Supabase wallet read failed: ${error.message}`);
    if (data) return Number(data.balance);

    const { error: insertError } = await this.client
      .from('wallets')
      .insert({ user_id: userId, balance: STARTING_BALANCE });
    if (insertError) throw new Error(`Supabase wallet init failed: ${insertError.message}`);
    return STARTING_BALANCE;
  }

  async setBalance(userId: string, balance: number): Promise<void> {
    const { error } = await this.client
      .from('wallets')
      .upsert({ user_id: userId, balance, updated_at: new Date().toISOString() });
    if (error) throw new Error(`Supabase wallet write failed: ${error.message}`);
  }

  async listBalances(): Promise<WalletBalanceRow[]> {
    const { data, error } = await this.client
      .from('wallets')
      .select('user_id, balance')
      .order('balance', { ascending: false });
    if (error) throw new Error(`Supabase wallet list failed: ${error.message}`);
    return (data ?? []).map((r: any) => ({ userId: String(r.user_id), balance: Number(r.balance) }));
  }
}

/**
 * Build the appropriate store. Supabase is imported lazily so its absence
 * never breaks local dev. Returns the in-memory store when credentials are
 * missing.
 */
export async function createWalletStore(): Promise<WalletStore> {
  if (!hasSupabase()) {
    log.info('Wallet: using in-memory store (no Supabase credentials configured).');
    return new InMemoryWalletStore();
  }
  try {
    const { createClient } = await import('@supabase/supabase-js');
    log.info('Wallet: using Supabase store.');
    return new SupabaseWalletStore(config.supabaseUrl, config.supabaseKey, createClient as never);
  } catch (err) {
    log.error('Wallet: failed to init Supabase, falling back to in-memory.', err);
    return new InMemoryWalletStore();
  }
}
