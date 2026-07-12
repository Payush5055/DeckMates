'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useThirtyOne } from '@/lib/thirtyOneSocketContext';
import { useAuth } from '@/lib/authContext';
import { sound } from '@/lib/audio';
import { Button } from '@/components/ui/Button';
import { Overlay } from '@/components/ui/Overlay';
import { SuitBullet, SuitDivider } from '@/components/ui/SuitDivider';
import { DetailCardIntro } from '@/components/DetailCardIntro';
import type { ThirtyOneCreateRoomReq } from '@cardadda/shared';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

// Accurate to the locked rules — knock penalty and instant-31 details included.
const RULES = [
  '3 cards each, 3 lives each. Same-suit cards add up: Ace = 11, face cards = 10, numbers = face value. Best single-suit total is your hand — an off-suit card only counts alone. Three of a kind = flat 30.',
  'On your turn: draw one card (face-down pile or the discard), then discard one. Max hand is 31.',
  'Or KNOCK instead of drawing — that’s your whole turn, and everyone else gets exactly one last turn before all hands are revealed.',
  'At the reveal, the lowest hand loses a life — but if the KNOCKER is lowest, they lose 2. Tie with the knocker and only you pay; the knocker is safe.',
  'Hit exactly 31 at any point — even straight off the deal — and the round ends instantly: everyone else loses a life.',
  'Run out of lives and you’re out. Last player standing wins.',
];

export default function ThirtyOneDetailPage() {
  const router = useRouter();
  const { createRoom } = useThirtyOne();
  const { ready, user, needsUsername } = useAuth();
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [teammates, setTeammates] = useState(1);

  function requireSignIn(): boolean {
    if (!ready) return false;
    if (!user || needsUsername) {
      router.push(`/login?next=${encodeURIComponent('/game/31')}`);
      return false;
    }
    return true;
  }

  function openChooser() {
    if (busy || !requireSignIn()) return;
    setError(null);
    setChooserOpen(true);
  }

  async function createWithMode(req: ThirtyOneCreateRoomReq) {
    if (busy) return;
    setBusy(true);
    setError(null);
    sound.init();
    const res = await createRoom(req);
    if (res.ok && res.roomCode) {
      router.push(`/table/31/${res.roomCode}`);
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
      const res = await fetch(`${SOCKET_URL}/api/rooms/thirtyone/${code}`);
      const data = (await res.json()) as { exists: boolean };
      if (!data.exists) {
        setError('No table found with that code');
        setBusy(false);
        return;
      }
    } catch {
      // If the check fails (server down), let the table page surface the error.
    }
    router.push(`/table/31/${code}`);
  }

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="relative mt-2 overflow-hidden rounded-3xl bg-surface px-8 py-10 shadow-table ring-1 ring-gold/20">
        <DetailCardIntro />
        <h1 className="font-serif text-4xl text-ink">31</h1>
        <p className="mt-2 text-muted">Scat, Blitz — chase 31, knock at your peril. 4 players, 3 lives each.</p>
      </header>

      <section className="mt-8 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="mb-3 font-serif text-xl text-ink">How to play</h2>
          <ul className="flex flex-col gap-2 text-sm text-ink/90">
            {RULES.map((r, i) => (
              <li key={i} className="flex">
                <SuitBullet suit={['♠', '♥', '♦', '♣', '♠', '♥'][i]} />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>

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

            <button
              onClick={() => void createWithMode({ mode: 'bots' })}
              disabled={busy}
              className="w-full rounded-xl bg-gold px-5 py-4 text-left text-rim transition hover:brightness-110 disabled:opacity-50"
            >
              <span className="block font-medium">Play with bots</span>
              <span className="block text-sm opacity-80">Start now — the other 3 seats are bots.</span>
            </button>

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
  );
}
