'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { TableSurface } from '@/components/table/TableSurface';
import { Avatar } from '@/components/table/Avatar';
import { CardBack } from '@/components/table/CardBack';
import { PlayingCard } from '@/components/table/PlayingCard';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { MuteToggle } from '@/components/ui/MuteToggle';
import { TeenPattiGameOverPanel } from '@/components/teenpatti/TeenPattiGameOverPanel';
import { useTeenPatti } from '@/lib/teenPattiSocketContext';
import { useAuth } from '@/lib/authContext';
import type { TeenPattiCard, TeenPattiSeat } from '@cardadda/shared';

type Pos = 'bottom' | 'left' | 'top' | 'right' | 'topLeft' | 'topRight';

const ORDER_BY_COUNT: Record<number, Pos[]> = {
  2: ['bottom', 'top'],
  3: ['bottom', 'left', 'right'],
  4: ['bottom', 'left', 'top', 'right'],
  5: ['bottom', 'left', 'topLeft', 'topRight', 'right'],
  6: ['bottom', 'left', 'topLeft', 'top', 'topRight', 'right'],
};

const POS_COLOR: Record<Pos, string> = {
  bottom: '#C9A24B',
  left: '#8B2635',
  top: '#3C3489',
  right: '#0F6E56',
  topLeft: '#6B4E16',
  topRight: '#29607D',
};

const POS_ANCHOR: Record<Pos, { left: string; top: string }> = {
  bottom: { left: '50%', top: '92%' },
  left: { left: '9%', top: '56%' },
  top: { left: '50%', top: '8%' },
  right: { left: '91%', top: '56%' },
  topLeft: { left: '24%', top: '18%' },
  topRight: { left: '76%', top: '18%' },
};

function positionFor(seat: TeenPattiSeat, you: TeenPattiSeat, numPlayers: number): Pos {
  const order = ORDER_BY_COUNT[numPlayers] ?? ORDER_BY_COUNT[4]!;
  const rel = (seat - you + numPlayers) % numPlayers;
  return order[rel] ?? 'bottom';
}

function HandRow({ cards }: { cards: TeenPattiCard[] }) {
  return (
    <div className="flex justify-center overflow-x-auto px-2 pt-3">
      <div className="flex -space-x-3">
        {cards.map((card, index) => (
          <PlayingCard key={`${card.suit}${card.rank}${index}`} card={card} size="lg" />
        ))}
      </div>
    </div>
  );
}

function HiddenHand() {
  return (
    <div className="flex justify-center overflow-x-auto px-2 pt-3">
      <div className="flex -space-x-3">
        <CardBack />
        <CardBack />
        <CardBack />
      </div>
    </div>
  );
}

export function TeenPattiTableView({ code }: { code: string }) {
  const {
    room,
    self,
    gameOver,
    error,
    playAgainCode,
    clearError,
    consumePlayAgainCode,
    joinRoom,
    startNow,
    seeCards,
    bet,
    fold,
    requestShow,
    requestSideShow,
    respondSideShow,
    leaveRoom,
    playAgain,
  } = useTeenPatti();
  const { ready: authReady, user, needsUsername } = useAuth();
  const router = useRouter();

  const [copied, setCopied] = useState(false);
  const [betAmount, setBetAmount] = useState('');
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (!authReady) return;
    if (!user || needsUsername) {
      router.replace(`/login?next=${encodeURIComponent(`/table/teenpatti/${code}`)}`);
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
    if (self && self.minBet !== null) setBetAmount(String(self.minBet));
  }, [self]);

  useEffect(() => {
    if (playAgainCode && playAgainCode !== code) {
      const next = playAgainCode;
      consumePlayAgainCode();
      attempted.current = false;
      router.push(`/table/teenpatti/${next}`);
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

  if (!authReady || !user || needsUsername) {
    return <main className="flex min-h-[60vh] items-center justify-center text-muted">Signing you in…</main>;
  }

  if (!room || room.roomCode !== code || !self) {
    return <main className="flex min-h-[60vh] items-center justify-center text-muted">Connecting to table {code}…</main>;
  }

  const you = self.seat;
  const numPlayers = room.players.length;
  const isHost = room.players.find((p) => p.seat === you)?.isHost ?? false;
  const onTurn = room.turn === you && (room.phase === 'playing' || room.phase === 'sideShow');
  const shownHand = self.hand;
  const folded = room.players.find((p) => p.seat === you)?.active === false;
  const pendingResponse = self.pendingSideShowResponse;

  const tableFacts = useMemo(
    () => [
      `Pot ${room.pot}`,
      `Stake ${room.currentStake}`,
      room.variant.toUpperCase(),
      room.jokerRank ? `Joker rank ${room.jokerRank}` : null,
    ].filter(Boolean),
    [room],
  );

  return (
    <div className={`mx-auto flex min-h-screen max-w-5xl flex-col px-3 ${room.phase === 'playing' || room.phase === 'sideShow' ? 'pb-72' : 'pb-6'}`}>
      <header className="flex items-center justify-end py-1">
        <div className="flex items-center gap-3 text-sm text-muted">
          <span>{tableFacts.join(' · ')}</span>
          <MuteToggle />
          <button
            onClick={() => (room.phase === 'waiting' ? handleLeave() : setShowLeaveConfirm(true))}
            className="rounded-lg px-2 py-1 text-ink/70 ring-1 ring-ink/20 hover:text-wine"
          >
            Leave
          </button>
        </div>
      </header>

      {showLeaveConfirm && (
        <ConfirmDialog
          message="Leaving an active Teen Patti hand ends the table for everyone."
          confirmLabel="Leave anyway"
          cancelLabel="Cancel"
          onConfirm={() => {
            setShowLeaveConfirm(false);
            handleLeave();
          }}
          onCancel={() => setShowLeaveConfirm(false)}
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

      {room.lastAction && (
        <div className="mb-2 rounded-xl bg-gold/10 px-4 py-2 text-center text-sm text-gold ring-1 ring-gold/30">
          {room.lastAction}
        </div>
      )}

      {folded && room.phase !== 'gameOver' && (
        <div className="mb-2 rounded-xl bg-ink/10 px-4 py-2 text-center text-sm text-muted ring-1 ring-ink/20">
          You folded — spectating the rest of the hand.
        </div>
      )}

      <div className="relative mt-2">
        <TableSurface>
          {room.players.map((p) => {
            const pos = positionFor(p.seat, you, numPlayers);
            const badge = room.phase === 'waiting'
              ? p.isBot
                ? 'Bot seat'
                : 'Waiting'
              : !p.active
                ? 'Packed'
                : p.seen
                  ? 'Seen'
                  : 'Blind';
            const isActive = room.turn === p.seat && p.active && (room.phase === 'playing' || room.phase === 'sideShow');
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
                  turnLabel={isActive ? (p.seat === you ? 'Your turn' : 'Thinking…') : undefined}
                  badge={badge}
                />
              </div>
            );
          })}

          {room.phase === 'waiting' && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 text-center">
              <p className="font-serif text-xl text-ink">Waiting for players</p>
              <p className="tabular text-3xl text-gold">{room.seatsFilled}</p>
              <p className="text-sm text-muted">
                {room.variant.toUpperCase()} · {room.players.length === 1 ? 'Invite friends to join' : 'Host can start when ready'}
              </p>
            </div>
          )}

          {(room.phase === 'playing' || room.phase === 'sideShow') && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 w-[72%] -translate-x-1/2 -translate-y-1/2 text-center">
              <div className="rounded-2xl bg-black/20 px-6 py-4 ring-1 ring-gold/20">
                <p className="font-serif text-xl text-ink">Pot {room.pot}</p>
                <p className="tabular mt-1 text-gold">Current stake {room.currentStake}</p>
                <p className="mt-1 text-sm text-muted">
                  {room.pendingSideShow
                    ? `Side show pending between seats ${room.pendingSideShow.requester + 1} and ${room.pendingSideShow.target + 1}`
                    : room.turn !== null
                      ? `Seat ${room.turn + 1} to act`
                      : 'Waiting'}
                </p>
              </div>
            </div>
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
            <Button variant="ghost" onClick={startNow}>
              Start now with {room.seatsFilled} player{room.seatsFilled === 1 ? '' : 's'}
            </Button>
          )}
        </div>
      )}

      {(room.phase === 'playing' || room.phase === 'sideShow') && (
        <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-rim via-rim/95 to-transparent pb-3 pt-6">
          <div className="mx-auto max-w-5xl px-3">
            <p className={`mb-2 text-center ${onTurn && !pendingResponse ? 'font-serif text-lg text-gold' : 'text-sm text-muted'}`}>
              {pendingResponse
                ? `Side show requested by seat ${pendingResponse.requester + 1}`
                : folded
                  ? 'You are spectating'
                  : room.phase === 'sideShow'
                    ? 'Waiting on the side show response…'
                    : onTurn
                      ? 'Your turn'
                      : 'Waiting for your turn…'}
            </p>

            {pendingResponse ? (
              <div className="mb-3 flex justify-center gap-3">
                <Button variant="secondary" onClick={() => respondSideShow({ accept: true })}>
                  Accept side show
                </Button>
                <Button variant="ghost" onClick={() => respondSideShow({ accept: false })}>
                  Refuse
                </Button>
              </div>
            ) : (
              <>
                {shownHand ? <HandRow cards={shownHand} /> : <HiddenHand />}

                {!folded && (
                  <div className="mt-4 rounded-2xl bg-surface/90 p-4 ring-1 ring-gold/20">
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {self.canSeeCards && (
                        <Button variant="ghost" onClick={seeCards}>
                          See cards
                        </Button>
                      )}
                      {self.canShow && (
                        <Button variant="secondary" onClick={requestShow}>
                          Show ({self.showCost})
                        </Button>
                      )}
                      {self.canSideShow && (
                        <Button variant="ghost" onClick={requestSideShow}>
                          Side show
                        </Button>
                      )}
                      {self.canFold && (
                        <Button variant="ghost" onClick={fold}>
                          Pack
                        </Button>
                      )}
                    </div>

                    {self.canBet && self.minBet !== null && self.maxBet !== null && (
                      <div className="mt-4 flex flex-col items-center gap-3">
                        <p className="text-sm text-muted">
                          Bet range: {self.minBet} to {self.maxBet}
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <button
                            onClick={() => setBetAmount(String(self.minBet))}
                            className="rounded-lg bg-rim/50 px-3 py-2 text-sm text-ink ring-1 ring-ink/20"
                          >
                            Min
                          </button>
                          <button
                            onClick={() => setBetAmount(String(self.maxBet))}
                            className="rounded-lg bg-rim/50 px-3 py-2 text-sm text-ink ring-1 ring-ink/20"
                          >
                            Max
                          </button>
                          <input
                            type="number"
                            min={self.minBet}
                            max={self.maxBet}
                            value={betAmount}
                            onChange={(e) => setBetAmount(e.target.value)}
                            className="tabular w-28 rounded-xl bg-rim/60 px-4 py-3 text-center text-ink outline-none ring-1 ring-ink/20 focus:ring-gold/60"
                          />
                          <Button
                            onClick={() => bet({ amount: Number(betAmount) })}
                            disabled={!betAmount || Number(betAmount) < self.minBet || Number(betAmount) > self.maxBet}
                          >
                            Bet
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {room.phase === 'gameOver' && gameOver && (
        <TeenPattiGameOverPanel
          result={gameOver}
          youSeat={you}
          onPlayAgain={() => void playAgain()}
          onHome={() => {
            leaveRoom();
            router.push('/');
          }}
        />
      )}
    </div>
  );
}
