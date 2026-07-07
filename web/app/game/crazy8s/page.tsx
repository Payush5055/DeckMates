'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCrazy8 } from '@/lib/crazy8SocketContext';
import { useAuth } from '@/lib/authContext';
import { sound } from '@/lib/audio';
import { Button } from '@/components/ui/Button';
import { Overlay } from '@/components/ui/Overlay';
import { SuitBullet, SuitDivider } from '@/components/ui/SuitDivider';
import { DetailCardIntro } from '@/components/DetailCardIntro';
import type { Crazy8CreateRoomReq } from '@cardadda/shared';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

const RULES = [
  'Standard 52-card deck. Match the suit or rank of the top discard card.',
  'Can’t play? Draw up to 3 cards — the moment one’s playable, play it and stop.',
  '8s are wild: play one any time and declare the suit that’s required next.',
  'A round ends when someone empties their hand — everyone else scores the cards left in hand.',
  'First to 100+ points ends the match — lowest total wins.',
];

export default function Crazy8DetailPage() {
  const router = useRouter();
  const { createRoom } = useCrazy8();
  const { ready, user, needsUsername } = useAuth();
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [tableSize, setTableSize] = useState<2 | 3 | 4>(4);
  const [teammates, setTeammates] = useState(1);

  function requireSignIn(): boolean {
    if (!ready) return false;
    if (!user || needsUsername) {
      router.push(`/login?next=${encodeURIComponent('/game/crazy8s')}`);
      return false;
    }
    return true;
  }

  function openChooser() {
    if (busy || !requireSignIn()) return;
    setError(null);
    setTeammates(Math.min(teammates, tableSize - 1));
    setChooserOpen(true);
  }

  async function createWithMode(req: Crazy8CreateRoomReq) {
    if (busy) return;
    setBusy(true);
    setError(null);
    sound.init();
    const res = await createRoom(req);
    if (res.ok && res.roomCode) {
      router.push(`/table/crazy8/${res.roomCode}`);
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
      const res = await fetch(`${SOCKET_URL}/api/rooms/crazy8/${code}`);
      const data = (await res.json()) as { exists: boolean };
      if (!data.exists) {
        setError('No table found with that code');
        setBusy(false);
        return;
      }
    } catch {
      // If the check fails (server down), let the table page surface the error.
    }
    router.push(`/table/crazy8/${code}`);
  }

  const teammateOptions = Array.from({ length: tableSize - 1 }, (_, i) => i + 1);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="relative mt-2 overflow-hidden rounded-3xl bg-surface px-8 py-10 shadow-table ring-1 ring-gold/20">
        <DetailCardIntro />
        <h1 className="font-serif text-4xl text-ink">Crazy 8s</h1>
        <p className="mt-2 text-muted">Match, dodge, and go wild with 8s. 2–4 players, first to 100 loses.</p>
      </header>

      <section className="mt-8 grid gap-8 md:grid-cols-2">
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

            <p className="mb-2 text-sm text-muted">Table size</p>
            <div className="mb-5 flex gap-2">
              {([2, 3, 4] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => {
                    setTableSize(n);
                    setTeammates((t) => Math.min(t, n - 1));
                  }}
                  className={`tabular h-11 flex-1 rounded-lg text-lg transition ${
                    tableSize === n ? 'bg-gold text-rim' : 'bg-rim/40 text-ink ring-1 ring-gold/40 hover:bg-gold/20'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>

            <button
              onClick={() => void createWithMode({ tableSize, mode: 'bots' })}
              disabled={busy}
              className="w-full rounded-xl bg-gold px-5 py-4 text-left text-rim transition hover:brightness-110 disabled:opacity-50"
            >
              <span className="block font-medium">Play with bots</span>
              <span className="block text-sm opacity-80">Start now — the other {tableSize - 1} seat{tableSize - 1 === 1 ? '' : 's'} {tableSize - 1 === 1 ? 'is' : 'are'} bots.</span>
            </button>

            <div className="mt-4 rounded-xl bg-rim/40 p-4 ring-1 ring-ink/15">
              <p className="font-medium text-ink">Play with teammates</p>
              <p className="mb-3 text-sm text-muted">
                How many friends are joining? You can also start early with fewer, or let empty seats fill with bots.
              </p>
              <div className="mb-4 flex gap-2">
                {teammateOptions.map((n) => (
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
                onClick={() => void createWithMode({ tableSize, mode: 'teammates', teammates })}
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
