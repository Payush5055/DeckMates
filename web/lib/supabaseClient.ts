'use client';

/**
 * Browser Supabase client — created only when the public env vars are present.
 * When Supabase isn't configured (e.g. before you've wired Google OAuth), this
 * is `null` and the app runs on the dev-auth bypass instead.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseEnabled = Boolean(url && anonKey);

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!supabaseEnabled) return null;
  if (!client) {
    client = createClient(url!, anonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true, // completes the OAuth redirect on /login
      },
    });
  }
  return client;
}

export const devAuthEnabled = process.env.NEXT_PUBLIC_DEV_AUTH === '1';
