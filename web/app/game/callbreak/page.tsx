'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTable } from '@/lib/socketContext';
import { useAuth } from '@/lib/authContext';
import { sound } from '@/lib/audio';
import { Button } from '@/components/ui/Button';
import { Overlay } from '@/components/ui/Overlay';
import { SuitBullet, SuitDivider } from '@/components/ui/SuitDivider';
import { AmbientPips } from '@/components/ui/AmbientPips';
import { DetailCardIntro } from '@/components/DetailCardIntro';
import type { CreateRoomReq } from '@cardadda/shared';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

const RULES = [
  'Four players, one standard 52-card deck, 13 cards each.',
  'Bid how many tricks you’ll win (1–8) before play begins — everyone bids at once, blind.',
  'Spades are always trump. Follow suit and beat the trick when you can — no ducking; cut with a spade when void.',
  'Make your bid: score your bid + 0.1 per extra trick. Miss it: lose your bid.',
  'Highest total after 5 rounds wins.',
];

export default function CallbreakDetailPage() {
  const router = useRouter();
  const { createRoom } = useTable();
  const { ready, user, needsUsername } = useAuth();
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [teammates, setTeammates] = useState(1);

  // Browsing this page is public; only ACTING (create/join) requires sign-in.
  function requireSignIn(): boolean {
    if (!ready) return false;
    if (!user || needsUsername) {
      router.push(`/login?next=${encodeURIComponent('/game/callbreak')}`);
      return false;
    }
    return true;
  }

  function openChooser() {
    if (busy || !requireSignIn()) return;
    setError(null);
    setChooserOpen(true);
  }

  async function createWithMode(req: CreateRoomReq) {
    if (busy) return;
    setBusy(true);
    setError(null);
    sound.init(); // unlock audio on first gesture
    const res = await createRoom(req);
    if (res.ok && res.roomCode) {
      router.push(`/table/${res.roomCode}`);
    } else {
      setError(res.error ?? 'Could not create a table');
      setBusy(false);
      setChooserOpen(false);
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
    router.push(`/table/${code}`);
  }

  return (
    <>
      <AmbientPips />
      <main className="relative z-10 mx-auto max-w-3xl px-4 pb-16">
      <header className="relative mt-2 overflow-hidden rounded-3xl bg-surface px-8 py-10 shadow-table ring-1 ring-gold/20">
        <div className="relative z-10 max-w-md">
          <h1 className="font-serif text-4xl text-ink">Callbreak</h1>
          <p className="mt-2 text-muted">A four-player trick-taking classic. Bid boldly, break with spades.</p>
        </div>
        <DetailCardIntro />
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
          <Button className="w-full" onClick={openChooser} disabled={busy}>
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

      {chooserOpen && (
        <Overlay>
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-table ring-1 ring-gold/30">
            <h2 className="text-center font-serif text-2xl text-ink">Start a table</h2>
            <SuitDivider className="my-4" />

            {/* Play with bots */}
            <button
              onClick={() => void createWithMode({ mode: 'bots' })}
              disabled={busy}
              className="w-full rounded-xl bg-gold px-5 py-4 text-left text-rim transition hover:brightness-110 disabled:opacity-50"
            >
              <span className="block font-medium">Play with bots</span>
              <span className="block text-sm opacity-80">Start now — the other 3 seats are bots.</span>
            </button>

            {/* Play with teammates */}
            <div className="mt-4 rounded-xl bg-rim/40 p-4 ring-1 ring-ink/15">
              <p className="font-medium text-ink">Play with teammates</p>
              <p className="mb-3 text-sm text-muted">
                How many friends are joining? Empty seats fill with bots once they’re in.
              </p>
              <div className="mb-4 flex gap-2">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => setTeammates(n)}
                    className={`tabular h-11 flex-1 rounded-lg text-lg transition ${
                      teammates === n
                        ? 'bg-gold text-rim'
                        : 'bg-surface text-ink ring-1 ring-gold/40 hover:bg-gold/20'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <Button
                variant="secondary"
                className="w-full"
                disabled={busy}
                onClick={() => void createWithMode({ mode: 'teammates', teammates })}
              >
                Create room for {teammates + 1} players
              </Button>
            </div>

            <button
              onClick={() => setChooserOpen(false)}
              disabled={busy}
              className="mt-4 w-full text-center text-sm text-muted hover:text-ink"
            >
              Cancel
            </button>
            {error && <p className="mt-3 text-center text-sm text-wine">{error}</p>}
          </div>
        </Overlay>
      )}
      </main>
    </>
  );
}
