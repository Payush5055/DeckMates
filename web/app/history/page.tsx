'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/authContext';
import { formatTenths, ordinal } from '@/lib/format';
import { SuitDivider } from '@/components/ui/SuitDivider';
import type { MatchRecord } from '@cardadda/shared';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

/** Past completed matches for the signed-in user. Names are fine to show here. */
export default function HistoryPage() {
  const { ready, user, needsUsername, token } = useAuth();
  const router = useRouter();
  const [matches, setMatches] = useState<MatchRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // History requires being signed in.
  useEffect(() => {
    if (ready && (!user || needsUsername)) {
      router.replace(`/login?next=${encodeURIComponent('/history')}`);
    }
  }, [ready, user, needsUsername, router]);

  useEffect(() => {
    if (!ready || !user || needsUsername || !token) return;
    fetch(`${SOCKET_URL}/api/history`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.json())
      .then((data: { matches?: MatchRecord[] }) => setMatches(data.matches ?? []))
      .catch(() => setError('Could not reach the game server.'));
  }, [ready, user, needsUsername, token]);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <nav className="flex items-center justify-between py-5">
        <Link href="/" className="font-serif text-xl text-gold">
          DeckMates
        </Link>
        <Link href="/game/callbreak" className="text-sm text-muted hover:text-ink">
          Play
        </Link>
      </nav>

      <h1 className="font-serif text-3xl text-ink">Match history</h1>
      <SuitDivider className="my-6" />

      {error && <p className="text-wine">{error}</p>}
      {!error && matches === null && <p className="text-muted">Loading…</p>}
      {!error && matches?.length === 0 && (
        <p className="text-muted">No matches yet. Play a game and it’ll show up here.</p>
      )}

      <ul className="flex flex-col gap-4">
        {matches?.map((m) => {
          const winnerRank = Math.min(...m.players.map((p) => p.rank));
          return (
            <li key={m.id ?? m.roomCode + m.playedAt} className="rounded-2xl bg-surface p-5 ring-1 ring-gold/15">
              <div className="mb-3 flex items-center justify-between text-sm text-muted">
                <span className="tabular">Room {m.roomCode}</span>
                <span>{new Date(m.playedAt).toLocaleString()}</span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {[...m.players]
                  .sort((a, b) => a.rank - b.rank)
                  .map((p) => (
                    <li key={p.seat} className="flex items-center gap-3 text-sm">
                      <span className="tabular w-9 text-gold">{ordinal(p.rank)}</span>
                      <span
                        className={`flex-1 ${p.rank === winnerRank ? 'text-ink' : 'text-ink/80'}`}
                      >
                        {p.name}
                      </span>
                      <span className="tabular font-semibold text-ink">{formatTenths(p.totalTenths)}</span>
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
