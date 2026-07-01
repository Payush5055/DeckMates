/**
 * Server-side identity verification.
 *
 * A player's identity is NEVER trusted from the client payload. It is derived
 * from the socket handshake token and verified here:
 *
 *   • Real token: a Supabase access-token JWT. We validate it with Supabase
 *     (`auth.getUser`) to get the authenticated user id, then look up the chosen
 *     username from the `profiles` table (service role).
 *   • Dev token: `dev:<username>` — only accepted when DEV_AUTH is enabled. The
 *     user id is derived deterministically from the username so the same name
 *     reconnects to the same seat across tabs.
 */

import { config, hasSupabase } from './config';
import { log } from './logger';

export interface Identity {
  userId: string;
  username: string;
}

const DEV_PREFIX = 'dev:';

/** Normalize a username into a stable, comparable slug for dev user ids. */
function slug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'player';
}

/** Lazily-created Supabase service client (only when configured). */
let supabase: { auth: { getUser: (t: string) => Promise<any> }; from: (t: string) => any } | null = null;
let supabaseInit = false;

async function getSupabase() {
  if (supabaseInit) return supabase;
  supabaseInit = true;
  if (!hasSupabase()) return null;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    supabase = createClient(config.supabaseUrl, config.supabaseKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    }) as never;
  } catch (err) {
    log.error('auth: failed to init Supabase client', err);
    supabase = null;
  }
  return supabase;
}

/**
 * Verify a handshake token and return the caller's identity, or throw if it's
 * invalid / unauthorized.
 */
export async function verifyToken(token: string | undefined): Promise<Identity> {
  if (!token || typeof token !== 'string') throw new Error('Missing auth token');

  // ── Dev bypass ────────────────────────────────────────────────────────────
  if (token.startsWith(DEV_PREFIX)) {
    if (!config.devAuth) throw new Error('Dev auth is disabled');
    const username = token.slice(DEV_PREFIX.length).trim().slice(0, 20) || 'Player';
    return { userId: `dev-${slug(username)}`, username };
  }

  // ── Real Supabase JWT ─────────────────────────────────────────────────────
  const client = await getSupabase();
  if (!client) throw new Error('Auth is not configured on the server');

  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) throw new Error('Invalid or expired session');
  const userId: string = data.user.id;

  // Username is required before joining; it lives in the profiles table.
  const profile = await client.from('profiles').select('username').eq('id', userId).single();
  const username: string | undefined = profile?.data?.username;
  if (!username) throw new Error('Choose a username before playing');

  return { userId, username };
}
