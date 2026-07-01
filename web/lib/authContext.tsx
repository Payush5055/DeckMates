'use client';

/**
 * AuthProvider — the single source of identity for the app.
 *
 * Two backends, chosen by env:
 *   • Supabase (real): Google OAuth. The signed-in user picks a unique username
 *     stored in the `profiles` table; the socket/history token is the Supabase
 *     access token (verified server-side).
 *   • Dev bypass (NEXT_PUBLIC_DEV_AUTH=1): pick any username; identity is a
 *     stable fake id derived from it, and the token is `dev:<username>`. Lets
 *     you run 4 tabs as 4 players before Google OAuth is wired.
 *
 * Exposes `token`, consumed by socketContext (handshake) and the history fetch.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { devAuthEnabled, getSupabase, supabaseEnabled } from './supabaseClient';

const DEV_USER_KEY = 'deckmates:devUser';

export interface AuthUser {
  id: string;
  username: string | null;
  /** True for dev-bypass identities. */
  isDev: boolean;
}

interface AuthContextValue {
  ready: boolean;
  user: AuthUser | null;
  /** Signed in but hasn't chosen a username yet (real users, first sign-in). */
  needsUsername: boolean;
  token: string | null;
  supabaseEnabled: boolean;
  devEnabled: boolean;
  signInWithGoogle: () => Promise<void>;
  signInAsDev: (username: string) => void;
  isUsernameAvailable: (username: string) => Promise<boolean>;
  chooseUsername: (username: string) => Promise<{ ok: boolean; error?: string }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function devSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) || 'player';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const dedupe = useRef<string | null>(null);

  // Apply a Supabase session: set token and resolve the user's username.
  const applySession = useCallback(async (session: { access_token: string; user: { id: string } }) => {
    const supabase = getSupabase();
    if (!supabase) return;
    setToken(session.access_token);
    const { data } = await supabase.from('profiles').select('username').eq('id', session.user.id).maybeSingle();
    const username = (data?.username as string | undefined) ?? null;
    setUser({ id: session.user.id, username, isDev: false });
    setNeedsUsername(!username);
  }, []);

  const loadDevUser = useCallback(() => {
    if (typeof window === 'undefined') return false;
    const raw = window.localStorage.getItem(DEV_USER_KEY);
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw) as { id: string; username: string };
      setUser({ id: parsed.id, username: parsed.username, isDev: true });
      setToken(`dev:${parsed.username}`);
      setNeedsUsername(false);
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    let unsub: (() => void) | undefined;
    (async () => {
      if (supabaseEnabled) {
        const supabase = getSupabase()!;
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          await applySession(data.session as never);
        } else if (!loadDevUser()) {
          setUser(null);
        }
        const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
          if (session) {
            void applySession(session as never);
          } else if (!loadDevUser()) {
            setUser(null);
            setToken(null);
            setNeedsUsername(false);
          }
        });
        unsub = () => sub.subscription.unsubscribe();
      } else {
        loadDevUser();
      }
      setReady(true);
    })();
    return () => unsub?.();
  }, [applySession, loadDevUser]);

  const signInWithGoogle = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/login` },
    });
  }, []);

  const signInAsDev = useCallback((username: string) => {
    const name = username.trim().slice(0, 20) || 'Player';
    const devUser = { id: `dev-${devSlug(name)}`, username: name };
    window.localStorage.setItem(DEV_USER_KEY, JSON.stringify(devUser));
    setUser({ ...devUser, isDev: true });
    setToken(`dev:${name}`);
    setNeedsUsername(false);
  }, []);

  const isUsernameAvailable = useCallback(async (username: string): Promise<boolean> => {
    const supabase = getSupabase();
    // In dev-only mode there's no shared DB; treat all names as available.
    if (!supabase) return true;
    const { data } = await supabase
      .from('profiles')
      .select('id')
      .ilike('username', username.trim())
      .maybeSingle();
    return !data;
  }, []);

  const chooseUsername = useCallback(
    async (username: string): Promise<{ ok: boolean; error?: string }> => {
      const name = username.trim();
      if (name.length < 3) return { ok: false, error: 'Username must be at least 3 characters' };
      const supabase = getSupabase();
      if (!supabase || !user) return { ok: false, error: 'Not signed in' };
      // The DB UNIQUE constraint is the real guard against a race; a duplicate
      // insert fails with code 23505 which we surface as "taken".
      const { error } = await supabase.from('profiles').insert({ id: user.id, username: name });
      if (error) {
        const taken = error.code === '23505' || /duplicate|unique/i.test(error.message);
        return { ok: false, error: taken ? 'That username is taken' : error.message };
      }
      setUser({ ...user, username: name });
      setNeedsUsername(false);
      return { ok: true };
    },
    [user],
  );

  const signOut = useCallback(async () => {
    window.localStorage.removeItem(DEV_USER_KEY);
    const supabase = getSupabase();
    if (supabase) await supabase.auth.signOut();
    setUser(null);
    setToken(null);
    setNeedsUsername(false);
  }, []);

  // Avoid redundant state churn logging in dev double-render.
  useEffect(() => {
    dedupe.current = user?.id ?? null;
  }, [user]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ready,
      user,
      needsUsername,
      token,
      supabaseEnabled,
      devEnabled: devAuthEnabled,
      signInWithGoogle,
      signInAsDev,
      isUsernameAvailable,
      chooseUsername,
      signOut,
    }),
    [ready, user, needsUsername, token, signInWithGoogle, signInAsDev, isUsernameAvailable, chooseUsername, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
