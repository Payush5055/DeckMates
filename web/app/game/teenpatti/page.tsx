'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTeenPatti } from '@/lib/teenPattiSocketContext';
import { useAuth } from '@/lib/authContext';
import { Button } from '@/components/ui/Button';
import { Overlay } from '@/components/ui/Overlay';
import { SuitBullet, SuitDivider } from '@/components/ui/SuitDivider';
import { AmbientPips } from '@/components/ui/AmbientPips';
import { DetailCardIntro } from '@/components/DetailCardIntro';
import type { TeenPattiCreateRoomReq, TeenPattiMode } from '@cardadda/shared';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

const RULES = [
  'Everyone antes the boot, then receives 3 private cards.',
  'Blind players bet from the current stake up to 2x; seen players bet from 2x up to 4x.',
  'If a blind player bet last, their full bet becomes the new stake. If a seen player bet last, only half their bet becomes the new stake.',
  'Blind players may look at their cards on a future turn and become seen from then on.',
  'Show is only when 2 players remain. Side show is only between seen players.',
  'Hands rank: Trail, Pure sequence, Sequence, Color, Pair, High card. A-2-3 counts as a sequence.',
];

const VARIANTS: { value: TeenPattiMode; label: string; detail: string }[] = [
  { value: 'classic', label: 'Classic', detail: 'No wildcards' },
  { value: 'joker', label: 'Joker', detail: 'One random rank becomes wild each hand' },
  { value: 'ak47', label: 'AK47', detail: 'A, K, 4, and 7 are always wild' },
];

export default function TeenPattiDetailPage() {
  const router = useRouter();
  const { createRoom } = useTeenPatti();
  const { ready, user, needsUsername } = useAuth();
  const [joinCode, setJoinCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [variant, setVariant] = useState<TeenPattiMode>('classic');

  function requireSignIn(): boolean {
    if (!ready) return false;
    if (!user || needsUsername) {
      router.push(`/login?next=${encodeURIComponent('/game/teenpatti')}`);
      return false;
    }
    return true;
  }

  function openChooser() {
    if (busy || !requireSignIn()) return;
    setError(null);
    setChooserOpen(true);
  }

  async function createWithMode(req: TeenPattiCreateRoomReq) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await createRoom(req);
    if (res.ok && res.roomCode) {
      router.push(`/table/teenpatti/${res.roomCode}`);
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
    try {
      const res = await fetch(`${SOCKET_URL}/api/rooms/teenpatti/${code}`);
      const data = (await res.json()) as { exists: boolean };
      if (!data.exists) {
        setError('No table found with that code');
        setBusy(false);
        return;
      }
    } catch {
      // If the check fails, let the table page surface the error.
    }
    router.push(`/table/teenpatti/${code}`);
  }

  return (
    <>
      <AmbientPips />
      <main className="relative z-10 mx-auto max-w-3xl px-4 pb-16">
        <header className="relative mt-2 overflow-hidden rounded-3xl bg-surface px-8 py-10 shadow-table ring-1 ring-gold/20">
          <div className="relative z-10 max-w-md">
            <h1 className="font-serif text-4xl text-ink">Teen Patti</h1>
            <p className="mt-2 text-muted">Blind bets, side shows, and wild variants at a live-feeling table.</p>
          </div>
          <DetailCardIntro />
        </header>

        <section className="mt-8 grid gap-8 md:grid-cols-2">
          <div>
            <h2 className="mb-3 font-serif text-xl text-ink">How to play</h2>
            <ul className="flex flex-col gap-2 text-sm text-ink/90">
              {RULES.map((rule, i) => (
                <li key={i} className="flex">
                  <SuitBullet suit={['♠', '♥', '♦', '♣', '♠', '♥'][i]} />
                  <span>{rule}</span>
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

              <p className="mb-3 text-sm text-muted">Choose the Teen Patti variant for this room.</p>
              <div className="mb-5 grid gap-2">
                {VARIANTS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setVariant(option.value)}
                    className={`rounded-xl px-4 py-3 text-left transition ${
                      variant === option.value
                        ? 'bg-gold text-rim'
                        : 'bg-rim/40 text-ink ring-1 ring-gold/30 hover:bg-gold/15'
                    }`}
                  >
                    <span className="block font-medium">{option.label}</span>
                    <span className={`block text-sm ${variant === option.value ? 'opacity-85' : 'text-muted'}`}>{option.detail}</span>
                  </button>
                ))}
              </div>

              <button
                onClick={() => void createWithMode({ mode: 'bots', variant })}
                disabled={busy}
                className="w-full rounded-xl bg-gold px-5 py-4 text-left text-rim transition hover:brightness-110 disabled:opacity-50"
              >
                <span className="block font-medium">Play with bots</span>
                <span className="block text-sm opacity-80">Fixed 4-seat table: you plus 3 bots.</span>
              </button>

              <div className="mt-4 rounded-xl bg-rim/40 p-4 ring-1 ring-ink/15">
                <p className="font-medium text-ink">Play with teammates</p>
                <p className="mb-3 text-sm text-muted">
                  Open a real-player table, share the code, and start manually once everyone is in.
                </p>
                <Button
                  variant="secondary"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void createWithMode({ mode: 'teammates', variant })}
                >
                  Create teammate table
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
