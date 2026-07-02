'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTable } from '@/lib/socketContext';
import { useAuth } from '@/lib/authContext';
import { TableSurface } from '@/components/table/TableSurface';
import { Avatar } from '@/components/table/Avatar';
import { MuteToggle } from '@/components/ui/MuteToggle';
import { Countdown } from '@/components/phases/Countdown';
import { Dealing } from '@/components/phases/Dealing';
import { BiddingControls } from '@/components/phases/BiddingControls';
import { TrickCards } from '@/components/phases/TrickCards';
import { YourHand } from '@/components/phases/YourHand';
import { RoundCompletePanel } from '@/components/phases/RoundCompletePanel';
import { MatchEndPanel } from '@/components/phases/MatchEndPanel';
import { POS_ANCHOR, POS_COLOR, relativePosition } from '@/lib/seatLayout';
import { cardId, type Seat } from '@cardadda/shared';

type Intro = 'countdown' | 'dealing' | null;

export function TableView({ code }: { code: string }) {
  const {
    room,
    self,
    roundResult,
    gameOver,
    error,
    playAgainCode,
    clearError,
    consumePlayAgainCode,
    joinRoom,
    placeBid,
    playCard,
    leaveRoom,
    playAgain,
  } = useTable();
  const { ready: authReady, user, needsUsername } = useAuth();
  const router = useRouter();

  const [copied, setCopied] = useState(false);
  const [intro, setIntro] = useState<Intro>(null);
  const attempted = useRef(false);
  const introducedRound = useRef(-1);

  // Auth guard, then join (or reclaim seat) on mount. Signing in is required.
  useEffect(() => {
    if (!authReady) return;
    if (!user || needsUsername) {
      router.replace(`/login?next=${encodeURIComponent(`/table/${code}`)}`);
      return;
    }
    if (attempted.current) return;
    if (room?.roomCode === code) {
      attempted.current = true;
      return;
    }
    attempted.current = true;
    void joinRoom(code);
  }, [authReady, user, needsUsername, room, code, joinRoom, router]);

  // A "play again" broadcast moves everyone to the new room.
  useEffect(() => {
    if (playAgainCode && playAgainCode !== code) {
      const next = playAgainCode;
      consumePlayAgainCode();
      attempted.current = false;
      router.push(`/table/${next}`);
    }
  }, [playAgainCode, code, router, consumePlayAgainCode]);

  // Trigger the countdown → deal intro at the start of each fresh round.
  useEffect(() => {
    if (!room) return;
    const freshRound =
      room.phase === 'bidding' &&
      room.players.length === 4 &&
      room.players.every((p) => p.bid === null) &&
      introducedRound.current !== room.roundNumber;
    if (freshRound) {
      introducedRound.current = room.roundNumber;
      setIntro('countdown');
    }
  }, [room]);

  function copyCode() {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleLeave() {
    leaveRoom();
    router.push('/');
  }

  // ── Gate: auth / connecting ───────────────────────────────────────────────
  if (!authReady || !user || needsUsername) {
    return (
      <CenteredCard>
        <p className="text-muted">Signing you in…</p>
      </CenteredCard>
    );
  }

  if (!room || room.roomCode !== code || !self) {
    return (
      <CenteredCard>
        <p className="text-muted">Connecting to table {code}…</p>
      </CenteredCard>
    );
  }

  const you = self.seat;
  const myBid = room.players.find((p) => p.seat === you)?.bid ?? null;
  const isMyTurn = room.turn === you;
  const legalIds = new Set(self.legalPlays.map(cardId));
  const canBid = !intro && room.phase === 'bidding' && isMyTurn && myBid === null;
  const canPlay = !intro && room.phase === 'playing' && isMyTurn;
  const showHand = !intro && (room.phase === 'bidding' || room.phase === 'playing') && self.hand.length > 0;

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-3 pb-6">
      {/* Table toolbar — branding lives in the global header; no scores here,
          keeping trick-play focused on the table. */}
      <header className="flex items-center justify-end py-1">
        <div className="flex items-center gap-3 text-sm text-muted">
          {room.phase !== 'waiting' && (
            <span className="tabular">
              Round {room.roundNumber}/{room.totalRounds}
            </span>
          )}
          <MuteToggle />
          <button onClick={handleLeave} className="rounded-lg px-2 py-1 text-ink/70 ring-1 ring-ink/20 hover:text-wine">
            Leave
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-2 flex items-center justify-between rounded-xl bg-wine/25 px-4 py-2 text-sm text-ink ring-1 ring-wine/50">
          <span>{error}</span>
          <div className="flex gap-2">
            <button onClick={clearError} className="text-ink/70 hover:text-ink">
              Dismiss
            </button>
            <Link href="/" className="text-gold hover:underline">
              Home
            </Link>
          </div>
        </div>
      )}

      {/* The table */}
      <div className="relative mt-2">
        <TableSurface>
          {/* Seats */}
          {room.players.map((p) => {
            const pos = relativePosition(p.seat, you);
            const badge = intro
              ? undefined
              : room.phase === 'bidding'
                ? p.bid !== null
                  ? `bid ${p.bid}`
                  : undefined
                : room.phase === 'playing' || room.phase === 'roundEnd'
                  ? `${p.tricksWon}/${p.bid ?? 0}`
                  : undefined;
            return (
              <div
                key={p.seat}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: POS_ANCHOR[pos].left, top: POS_ANCHOR[pos].top }}
              >
                <Avatar
                  color={POS_COLOR[pos]}
                  connected={p.connected}
                  active={room.turn === p.seat && !intro}
                  badge={badge}
                />
              </div>
            );
          })}

          {/* Center content by phase */}
          {intro === 'countdown' && <Countdown seconds={3} onDone={() => setIntro('dealing')} />}
          {intro === 'dealing' && <Dealing onDone={() => setIntro(null)} />}
          {!intro && room.phase === 'playing' && <TrickCards trick={room.currentTrick} youSeat={you} />}
          {!intro && room.phase === 'waiting' && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 text-center">
              <p className="font-serif text-xl text-ink">Waiting for players</p>
              <p className="tabular text-3xl text-gold">{room.seatsFilled}/4</p>
            </div>
          )}
          {!intro && room.phase === 'bidding' && (
            <div className="pointer-events-none absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2 text-center font-serif text-lg text-ink/80">
              {isMyTurn && myBid === null ? 'Your bid' : 'Bidding…'}
            </div>
          )}
        </TableSurface>
      </div>

      {/* Share code while waiting */}
      {room.phase === 'waiting' && (
        <div className="mt-5 flex flex-col items-center gap-2">
          <p className="text-sm text-muted">Share this code so friends can join:</p>
          <button
            onClick={copyCode}
            className="tabular rounded-xl bg-surface px-6 py-3 text-2xl tracking-[0.3em] text-gold ring-1 ring-gold/40 hover:brightness-110"
          >
            {code}
          </button>
          <span className="h-4 text-xs text-muted">{copied ? 'Copied!' : ''}</span>
        </div>
      )}

      {/* Bidding controls */}
      {!intro && room.phase === 'bidding' && (
        <div className="mt-5">
          {canBid ? (
            <BiddingControls onBid={placeBid} disabled={false} />
          ) : (
            <p className="text-center text-muted">Waiting for other players to bid…</p>
          )}
        </div>
      )}

      {/* Your hand */}
      {showHand && (
        <div className="mt-auto">
          {room.phase === 'playing' && (
            <p className="mb-1 text-center text-sm text-muted">
              {canPlay ? 'Your turn — play a card' : 'Waiting for your turn…'}
            </p>
          )}
          <YourHand cards={self.hand} legalIds={legalIds} canPlay={canPlay} onPlay={playCard} />
        </div>
      )}

      {/* Result overlays */}
      {room.phase === 'roundEnd' && roundResult && roundResult.roundNumber === room.roundNumber && (
        <RoundCompletePanel result={roundResult} youSeat={you} />
      )}
      {room.phase === 'gameOver' && gameOver && (
        <MatchEndPanel
          result={gameOver}
          youSeat={you}
          onPlayAgain={() => void playAgain()}
          onHome={handleLeave}
        />
      )}
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-6 text-center shadow-table ring-1 ring-gold/20">
        {children}
      </div>
    </div>
  );
}
