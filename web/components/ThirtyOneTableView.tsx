'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useThirtyOne } from '@/lib/thirtyOneSocketContext';
import { useAuth } from '@/lib/authContext';
import { TableSurface } from '@/components/table/TableSurface';
import { Avatar } from '@/components/table/Avatar';
import { MuteToggle } from '@/components/ui/MuteToggle';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { YourHand } from '@/components/phases/YourHand';
import { DiscardDrawPiles } from '@/components/crazy8/DiscardDrawPiles';
import { RevealPanel } from '@/components/thirtyone/RevealPanel';
import { GameOverPanel } from '@/components/thirtyone/GameOverPanel';
import { LivesPanel } from '@/components/thirtyone/LivesPanel';
import { POS_ANCHOR, POS_COLOR, relativePosition } from '@/lib/seatLayout';
import { cardId, type ThirtyOneSeat } from '@cardadda/shared';
import { handValue } from '@cardadda/thirtyone-engine';

export function ThirtyOneTableView({ code }: { code: string }) {
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
    knock,
    drawCard,
    discardCard,
    leaveRoom,
    playAgain,
  } = useThirtyOne();
  const { ready: authReady, user, needsUsername } = useAuth();
  const router = useRouter();

  const [copied, setCopied] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (!authReady) return;
    if (!user || needsUsername) {
      router.replace(`/login?next=${encodeURIComponent(`/table/31/${code}`)}`);
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

  useEffect(() => {
    if (playAgainCode && playAgainCode !== code) {
      const next = playAgainCode;
      consumePlayAgainCode();
      attempted.current = false;
      router.push(`/table/31/${next}`);
    }
  }, [playAgainCode, code, router, consumePlayAgainCode]);

  function copyCode() {
    void navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleLeave() {
    leaveRoom();
    router.push('/');
  }

  function requestLeave(isHost: boolean, inMatch: boolean) {
    if (isHost && inMatch) {
      setShowLeaveConfirm(true);
      return;
    }
    handleLeave();
  }

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
  const inGame = room.phase !== 'waiting';
  const isHost = room.players.find((p) => p.seat === you)?.isHost ?? false;
  const eliminated = room.players.find((p) => p.seat === you)?.eliminated ?? false;
  const showBottomBar = room.phase === 'playing' && !eliminated;
  const myValue = self.hand.length === 3 ? handValue(self.hand) : null;
  // During discard stage all 4 cards are clickable; otherwise the hand is inert.
  const legalIds = self.mustDiscard ? new Set(self.hand.map(cardId)) : new Set<string>();

  return (
    <div className={`mx-auto flex min-h-screen max-w-4xl flex-col px-3 ${showBottomBar ? 'pb-64' : 'pb-6'}`}>
      <header className="flex items-center justify-end py-1">
        <div className="flex items-center gap-3 text-sm text-muted">
          {inGame && <span className="tabular">Round {room.roundNumber}</span>}
          {inGame && (
            <button
              onClick={() => setShowScores((v) => !v)}
              aria-pressed={showScores}
              className={`rounded-lg px-2 py-1 ring-1 ring-ink/20 transition hover:text-gold ${
                showScores ? 'text-gold ring-gold/50' : 'text-ink/70'
              }`}
            >
              Scores
            </button>
          )}
          <MuteToggle />
          <button
            onClick={() => requestLeave(isHost, inGame)}
            className="rounded-lg px-2 py-1 text-ink/70 ring-1 ring-ink/20 hover:text-wine"
          >
            Leave
          </button>
        </div>
      </header>

      {showLeaveConfirm && (
        <ConfirmDialog
          message="Leaving will end the game for everyone."
          confirmLabel="Leave anyway"
          cancelLabel="Cancel"
          onConfirm={() => {
            setShowLeaveConfirm(false);
            handleLeave();
          }}
          onCancel={() => setShowLeaveConfirm(false)}
        />
      )}

      {inGame && showScores && (
        <LivesPanel players={room.players} youSeat={you} onClose={() => setShowScores(false)} />
      )}

      {inGame && eliminated && room.phase !== 'gameOver' && (
        <div className="mb-2 rounded-xl bg-ink/10 px-4 py-2 text-center text-sm text-muted ring-1 ring-ink/20">
          You're out — spectating the rest of the match
        </div>
      )}

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

      {/* Final-round banner: nobody should wonder why the game hasn't ended. */}
      {room.phase === 'playing' && room.knockerSeat !== null && (
        <div className="mb-2 rounded-xl bg-gold/15 px-4 py-2 text-center text-sm font-medium text-gold ring-1 ring-gold/40">
          {(room.players.find((p) => p.seat === room.knockerSeat)?.isBot
            ? 'Bot'
            : room.players.find((p) => p.seat === room.knockerSeat)?.name) ?? 'Someone'}{' '}
          knocked — final round: {room.finalTurnsRemaining}{' '}
          more turn{room.finalTurnsRemaining === 1 ? '' : 's'} before the reveal
        </div>
      )}

      <div className="relative mt-2">
        <TableSurface>
          {room.players.map((p) => {
            const pos = relativePosition(p.seat, you);
            const isActive = room.turn === p.seat && room.phase === 'playing';
            const badge = !inGame
              ? undefined
              : p.eliminated
                ? 'Out'
                : `${'♥'.repeat(Math.max(0, p.lives))}${p.seat === room.knockerSeat ? ' · knocked' : ''}`;
            return (
              <div
                key={p.seat}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: POS_ANCHOR[pos].left, top: POS_ANCHOR[pos].top }}
              >
                <Avatar
                  color={POS_COLOR[pos]}
                  connected={p.connected}
                  active={isActive}
                  label={p.isBot ? 'Bot' : p.name}
                  isBot={p.isBot}
                  isYou={p.seat === you}
                  turnLabel={isActive ? (p.seat === you ? 'Your turn' : 'Playing…') : undefined}
                  badge={badge}
                />
              </div>
            );
          })}

          {room.phase === 'waiting' && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 text-center">
              <p className="font-serif text-xl text-ink">Waiting for players</p>
              <p className="tabular text-3xl text-gold">{room.seatsFilled}/4</p>
            </div>
          )}

          {(room.phase === 'playing' || room.phase === 'roundEnd') && (
            <DiscardDrawPiles
              topCard={room.topDiscard}
              requiredSuit={null}
              drawPileCount={room.drawPileCount}
            />
          )}
        </TableSurface>
      </div>

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

      {showBottomBar && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-rim via-rim/95 to-transparent pb-3 pt-6">
          <div className="mx-auto max-w-4xl px-3">
            <p
              className={`mb-1 text-center ${
                self.canDraw || self.mustDiscard ? 'font-serif text-lg text-gold' : 'text-sm text-muted'
              }`}
            >
              {self.canDraw
                ? 'Your turn — draw a card, or knock'
                : self.mustDiscard
                  ? 'Now discard one card'
                  : 'Waiting for your turn…'}
              {myValue !== null && <span className="tabular ml-2 text-sm text-muted">(hand: {myValue})</span>}
            </p>

            {self.canDraw && (
              <div className="mb-2 flex items-center justify-center gap-3">
                <Button variant="primary" onClick={() => drawCard('pile')}>
                  Draw card
                </Button>
                <Button variant="ghost" onClick={() => drawCard('discard')} disabled={!room.topDiscard}>
                  Take discard
                </Button>
                {/* Knock is a different KIND of action — kept visually apart. */}
                <span className="mx-1 h-8 w-px bg-ink/20" aria-hidden />
                <Button variant="secondary" onClick={knock} disabled={!self.canKnock} title="End the round: everyone else gets one last turn">
                  Knock
                </Button>
              </div>
            )}

            <YourHand cards={self.hand} legalIds={legalIds} canPlay={self.mustDiscard} onPlay={discardCard} />
          </div>
        </div>
      )}

      {room.phase === 'roundEnd' && roundResult && roundResult.roundNumber === room.roundNumber && (
        <RevealPanel result={roundResult} youSeat={you} />
      )}
      {room.phase === 'gameOver' && gameOver && (
        <GameOverPanel
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
