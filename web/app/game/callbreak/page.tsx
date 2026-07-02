'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTable } from '@/lib/socketContext';
import { useAuth } from '@/lib/authContext';
import { sound } from '@/lib/audio';
import { Button } from '@/components/ui/Button';
import { SuitBullet, SuitDivider } from '@/components/ui/SuitDivider';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

const RULES = [
  'Four players, one standard 52-card deck, 13 cards each.',
  'Bid how many tricks you’ll win (1–8) before play begins.',
  'Spades are always trump. Follow the lead suit if you can.',
  'Make your bid: score your bid + 0.1 per extra trick. Miss it: lose your bid.',
  'Highest total after 5 rounds wins.',
];

export default function CallbreakDetailPage() {
  const router = useRouter();
  const { createRoom, joinRoom } = useTable();
  const { ready, user, needsUsername } = useAuth();
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Browsing this page is public; only ACTING (create/join) requires sign-in.
  // Returns false after redirecting a signed-out player to /login?next=….
  function requireSignIn(): boolean {
    if (!ready) return false;
    if (!user || needsUsername) {
      router.push(`/login?next=${encodeURIComponent('/game/callbreak')}`);
      return false;
    }
    return true;
  }

  async function handleCreate() {
    if (busy || !requireSignIn()) return;
    setBusy(true);
    setError(null);
    sound.init(); // unlock audio on first gesture
    const res = await createRoom();
    if (res.ok && res.roomCode) {
      router.push(`/table/${res.roomCode}`);
    } else {
      setError(res.error ?? 'Could not create a table');
      setBusy(false);
    }
  }

  async function handleJoin() {
    if (busy || !requireSignIn()) return;
    const code = joinCode.trim().toUpperCase();
    if (code.length < 4) {
      setError('Enter a room code');
      return;
    }
    setBusy(true);
    setError(null);
    sound.init();
    // Validate the room exists before navigating (nicer than a dead table page).
    try {
      const res = await fetch(`${SOCKET_URL}/api/rooms/${code}`);
      const data = (await res.json()) as { exists: boolean };
      if (!data.exists) {
        setError('No table found with that code');
        setBusy(false);
        return;
      }
    } catch {
      // If the check fails (server down), let the table page surface the error.
    }
    void joinRoom; // join happens on the table page after navigation
    router.push(`/table/${code}`);
  }

  // This page is PUBLIC — rules and description render for everyone. Sign-in
  // state lives in the global header; creating/joining redirects via
  // requireSignIn() when signed out.
  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="mt-2 rounded-3xl bg-surface px-8 py-10 shadow-table ring-1 ring-gold/20">
        <h1 className="font-serif text-4xl text-ink">Callbreak</h1>
        <p className="mt-2 text-muted">A four-player trick-taking classic. Bid boldly, break with spades.</p>
      </header>

      <section className="mt-8 grid gap-8 md:grid-cols-2">
        {/* Rules */}
        <div>
          <h2 className="mb-3 font-serif text-xl text-ink">How to play</h2>
          <ul className="flex flex-col gap-2 text-sm text-ink/90">
            {RULES.map((r, i) => (
              <li key={i} className="flex">
                <SuitBullet suit={['♠', '♥', '♦', '♣', '♠'][i]} />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Actions */}
        <div className="rounded-2xl bg-surface p-6 ring-1 ring-gold/20">
          <Button className="w-full" onClick={handleCreate} disabled={busy}>
            Create table
          </Button>

          <SuitDivider className="my-5" />

          <label className="mb-1 block text-sm text-muted">Join with code</label>
          <div className="flex gap-2">
            <input
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              maxLength={6}
              placeholder="ABC123"
              className="tabular w-full rounded-xl bg-rim/60 px-4 py-3 tracking-[0.2em] text-ink outline-none ring-1 ring-ink/20 focus:ring-gold/60"
            />
            <Button variant="ghost" onClick={handleJoin} disabled={busy}>
              Join
            </Button>
          </div>

          {error && <p className="mt-3 text-sm text-wine">{error}</p>}
        </div>
      </section>
    </main>
  );
}
