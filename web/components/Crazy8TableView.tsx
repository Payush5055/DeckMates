'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useCrazy8 } from '@/lib/crazy8SocketContext';
import { useAuth } from '@/lib/authContext';
import { TableSurface } from '@/components/table/TableSurface';
import { Avatar } from '@/components/table/Avatar';
import { MuteToggle } from '@/components/ui/MuteToggle';
import { Button } from '@/components/ui/Button';
import { YourHand } from '@/components/phases/YourHand';
import { DiscardDrawPiles } from '@/components/crazy8/DiscardDrawPiles';
import { SuitPicker } from '@/components/crazy8/SuitPicker';
import { RoundResultPanel } from '@/components/crazy8/RoundResultPanel';
import { GameOverPanel } from '@/components/crazy8/GameOverPanel';
import { ScoresPanel } from '@/components/crazy8/ScoresPanel';
import { POS_ANCHOR, POS_COLOR, relativePosition } from '@/lib/seatLayout';
import { cardId, type Crazy8Card, type Crazy8Seat } from '@cardadda/shared';

export function Crazy8TableView({ code }: { code: string }) {
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
    startNow,
    playCard,
    drawCards,
    leaveRoom,
    playAgain,
  } = useCrazy8();
  const { ready: authReady, user, needsUsername } = useAuth();
  const router = useRouter();

  const [copied, setCopied] = useState(false);
  const [showScores, setShowScores] = useState(false);
  const [pendingEight, setPendingEight] = useState<Crazy8Card | null>(null);
  const attempted = useRef(false);

  useEffect(() => {
    if (!authReady) return;
    if (!user || needsUsername) {
      router.replace(`/login?next=${encodeURIComponent(`/table/crazy8/${code}`)}`);
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
      router.push(`/table/crazy8/${next}`);
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

  /** Intercept a card click: an 8 needs a declared suit before it's sent. */
  function handlePlay(card: Crazy8Card) {
    if (card.rank === 8) {
      setPendingEight(card);
    } else {
      playCard(card);
    }
  }

  function handleDeclareSuit(suit: 'S' | 'H' | 'D' | 'C') {
    if (pendingEight) playCard(pendingEight, suit);
    setPendingEight(null);
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
  const numPlayers = room.phase === 'waiting' ? room.tableSize : room.numPlayers;
  const isMyTurn = room.turn === you;
  const legalIds = new Set(self.legalPlays.map(cardId));
  const mustDraw = room.phase === 'playing' && isMyTurn && self.legalPlays.length === 0;
  const canPlay = room.phase === 'playing' && isMyTurn && self.legalPlays.length > 0;
  const showHand = (room.phase === 'playing' || room.phase === 'roundEnd') && self.hand.length > 0;
  const isHost = room.players.find((p) => p.seat === you)?.isHost ?? false;
  const inGame = room.phase !== 'waiting';
  const showBottomBar = room.phase === 'playing';

  return (
    <div className={`mx-auto flex min-h-screen max-w-4xl flex-col px-3 ${showBottomBar ? 'pb-60' : 'pb-6'}`}>
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
          <button onClick={handleLeave} className="rounded-lg px-2 py-1 text-ink/70 ring-1 ring-ink/20 hover:text-wine">
            Leave
          </button>
        </div>
      </header>

      {inGame && showScores && (
        <ScoresPanel
          players={room.players}
          scores={room.scores}
          roundHistory={room.roundHistory}
          youSeat={you}
          onClose={() => setShowScores(false)}
        />
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

      <div className="relative mt-2">
        <TableSurface>
          {room.players.map((p) => {
            const pos = relativePosition(p.seat as Crazy8Seat, you, numPlayers);
            const isActive = room.turn === p.seat && room.phase === 'playing';
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
                  badge={room.phase !== 'waiting' ? `${p.cardCount} cards` : undefined}
                />
              </div>
            );
          })}

          {room.phase === 'waiting' && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 text-center">
              <p className="font-serif text-xl text-ink">Waiting for players</p>
              <p className="tabular text-3xl text-gold">
                {room.seatsFilled}/{room.tableSize}
              </p>
            </div>
          )}

          {(room.phase === 'playing' || room.phase === 'roundEnd') && (
            <DiscardDrawPiles
              topCard={room.topCard}
              requiredSuit={room.requiredSuit}
              drawPileCount={room.drawPileCount}
            />
          )}
        </TableSurface>
      </div>

      {room.phase === 'waiting' && (
        <div className="mt-5 flex flex-col items-center gap-3">
          <p className="text-sm text-muted">Share this code so friends can join:</p>
          <button
            onClick={copyCode}
            className="tabular rounded-xl bg-surface px-6 py-3 text-2xl tracking-[0.3em] text-gold ring-1 ring-gold/40 hover:brightness-110"
          >
            {code}
          </button>
          <span className="h-4 text-xs text-muted">{copied ? 'Copied!' : ''}</span>
          {isHost && room.canStartNow && (
            <Button variant="ghost" onClick={startNow} className="mt-1">
              Start now with {room.seatsFilled} player{room.seatsFilled === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      )}

      {showBottomBar && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-rim via-rim/95 to-transparent pb-3 pt-6">
          <div className="mx-auto max-w-4xl px-3">
            <p className={`mb-1 text-center ${canPlay || mustDraw ? 'font-serif text-lg text-gold' : 'text-sm text-muted'}`}>
              {canPlay
                ? 'Your turn — play a card'
                : mustDraw
                  ? 'No legal play — draw a card'
                  : 'Waiting for your turn…'}
            </p>
            {mustDraw && (
              <div className="mb-2 flex justify-center">
                <Button variant="primary" onClick={drawCards}>
                  Draw
                </Button>
              </div>
            )}
            {showHand && (
              <YourHand cards={self.hand} legalIds={legalIds} canPlay={canPlay} onPlay={handlePlay} />
            )}
          </div>
        </div>
      )}

      {pendingEight && <SuitPicker onChoose={handleDeclareSuit} />}

      {room.phase === 'roundEnd' && roundResult && roundResult.roundNumber === room.roundNumber && (
        <RoundResultPanel result={roundResult} youSeat={you} numPlayers={numPlayers} />
      )}
      {room.phase === 'gameOver' && gameOver && (
        <GameOverPanel
          result={gameOver}
          youSeat={you}
          numPlayers={numPlayers}
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
