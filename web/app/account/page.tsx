'use client';

/**
 * Account page: signed-in username, full match history, and sign-out.
 * Replaces the old standalone /history page (which now redirects here).
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/authContext';
import { formatTenths, ordinal } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { SuitDivider } from '@/components/ui/SuitDivider';
import type { Crazy8MatchPlayerRecord, MatchPlayerRecord, MatchRecord } from '@cardadda/shared';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

/**
 * Each game stores its score differently (Callbreak: decimal `totalTenths`;
 * Crazy 8s: plain whole `total`) — TS can't narrow `p`'s type through the
 * sort/map chain below, so branch explicitly here instead of an inline cast.
 */
function displayScore(m: MatchRecord, p: MatchPlayerRecord | Crazy8MatchPlayerRecord): string {
  if (m.gameType === 'crazy8s') return String((p as Crazy8MatchPlayerRecord).total);
  return formatTenths((p as MatchPlayerRecord).totalTenths);
}

export default function AccountPage() {
  const { ready, user, needsUsername, token, signOut } = useAuth();
  const router = useRouter();
  const [matches, setMatches] = useState<MatchRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The account page requires being signed in.
  useEffect(() => {
    if (ready && (!user || needsUsername)) {
      router.replace(`/login?next=${encodeURIComponent('/account')}`);
    }
  }, [ready, user, needsUsername, router]);

  useEffect(() => {
    if (!ready || !user || needsUsername || !token) return;
    fetch(`${SOCKET_URL}/api/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data: { matches?: MatchRecord[] }) => setMatches(data.matches ?? []))
      .catch(() => setError('Could not reach the game server.'));
  }, [ready, user, needsUsername, token]);

  async function handleSignOut() {
    await signOut();
    router.push('/');
  }

  if (!ready || !user || needsUsername) {
    return <main className="flex min-h-[60vh] items-center justify-center text-muted">Loading…</main>;
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      {/* Identity card */}
      <section className="mt-2 flex items-center justify-between rounded-2xl bg-surface px-6 py-5 shadow-table ring-1 ring-gold/20">
        <div className="flex items-center gap-4">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-full ring-2 ring-black/30"
            style={{ backgroundColor: '#C9A24B' }}
            aria-hidden
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="#F3EDE0">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8Z" />
            </svg>
          </span>
          <div>
            <h1 className="font-serif text-2xl text-ink">{user.username}</h1>
            {user.isDev && <p className="text-xs text-muted">dev test account</p>}
          </div>
        </div>
        <Button variant="ghost" onClick={() => void handleSignOut()}>
          Sign out
        </Button>
      </section>

      <h2 className="mt-10 font-serif text-2xl text-ink">Match history</h2>
      <SuitDivider className="my-5" />

      {error && <p className="text-wine">{error}</p>}
      {!error && matches === null && <p className="text-muted">Loading…</p>}
      {!error && matches?.length === 0 && (
        <p className="text-muted">No matches yet. Play a game and it’ll show up here.</p>
      )}

      <ul className="flex flex-col gap-4">
        {matches?.map((m) => {
          const winnerRank = Math.min(...m.players.map((p) => p.rank));
          const gameLabel = m.gameType === 'crazy8s' ? 'Crazy 8s' : 'Callbreak';
          return (
            <li key={m.id ?? m.roomCode + m.playedAt} className="rounded-2xl bg-surface p-5 ring-1 ring-gold/15">
              <div className="mb-3 flex items-center justify-between text-sm text-muted">
                <span>
                  <span className="text-gold">{gameLabel}</span>
                  <span className="tabular"> · Room {m.roomCode}</span>
                </span>
                <span>{new Date(m.playedAt).toLocaleString()}</span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {[...m.players]
                  .sort((a, b) => a.rank - b.rank)
                  .map((p) => (
                    <li key={p.seat} className="flex items-center gap-3 text-sm">
                      <span className="tabular w-9 text-gold">{ordinal(p.rank)}</span>
                      <span className={`flex-1 ${p.rank === winnerRank ? 'text-ink' : 'text-ink/80'}`}>
                        {p.name}
                      </span>
                      <span className="tabular font-semibold text-ink">{displayScore(m, p)}</span>
                    </li>
                  ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
