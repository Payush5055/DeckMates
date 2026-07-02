'use client';

/**
 * Global header, rendered on every page via the root layout (not per-page).
 *
 *   • Signed out → a gold "Sign in" CTA (real button weight, not a text link).
 *   • Signed in  → the player's avatar + username, linking to /account.
 *
 * A user who authenticated but hasn't chosen a username yet is treated as not
 * fully signed in — the Sign in button routes them to /login, which shows the
 * username picker.
 */

import Link from 'next/link';
import { useAuth } from '@/lib/authContext';

export function SiteHeader() {
  const { ready, user, needsUsername } = useAuth();
  const signedIn = ready && user !== null && !needsUsername;

  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4">
      <Link href="/" className="font-serif text-2xl text-gold">
        DeckMates
      </Link>

      {!ready ? (
        // Reserve the space so the header doesn't jump once auth resolves.
        <span className="h-10 w-24" aria-hidden />
      ) : signedIn ? (
        <Link
          href="/account"
          className="flex items-center gap-2.5 rounded-xl py-1.5 pl-1.5 pr-4 ring-1 ring-gold/30 transition hover:ring-gold/70"
        >
          {/* Gold "you" avatar — same visual language as the table seats. */}
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full ring-1 ring-black/30"
            style={{ backgroundColor: '#C9A24B' }}
            aria-hidden
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="#F3EDE0">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8Z" />
            </svg>
          </span>
          <span className="text-sm text-ink">{user!.username}</span>
        </Link>
      ) : (
        <Link
          href="/login"
          className="rounded-xl bg-gold px-5 py-2.5 font-medium text-rim transition hover:brightness-110"
        >
          Sign in
        </Link>
      )}
    </header>
  );
}
