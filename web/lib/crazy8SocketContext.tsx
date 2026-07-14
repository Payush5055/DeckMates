'use client';

/**
 * Crazy8Provider owns a second, independent socket.io connection dedicated to
 * Crazy 8s events. Kept separate from TableProvider (Callbreak) rather than
 * sharing one socket, since the two games' state shapes are unrelated and this
 * avoids touching the already-proven Callbreak connection code. The connection
 * is created lazily (on first action), so players who never open a Crazy 8s
 * table never pay for an idle second connection.
 *
 * Mirrors socketContext.tsx's structure exactly, adapted for Crazy8's events:
 * variable table size, the draw-up-to-3 mechanic, and the wild-8 declared suit.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  Crazy8ClientEvents,
  Crazy8ServerEvents,
  type Crazy8Card,
  type Crazy8CreateRoomReq,
  type Crazy8CreateRoomRes,
  type Crazy8GameOverPayload,
  type Crazy8JoinRoomRes,
  type Crazy8PlayAgainRes,
  type Crazy8PublicRoomState,
  type Crazy8RoomStateUpdate,
  type Crazy8RoundResultPayload,
  type Crazy8SelfState,
  type Crazy8Suit,
} from '@cardadda/shared';
import { sound } from './audio';
import { useAuth } from './authContext';

function cardKey(card: Crazy8Card | null): string {
  return card ? `${card.suit}${card.rank}` : '';
}

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

interface Crazy8ContextValue {
  connected: boolean;
  room: Crazy8PublicRoomState | null;
  self: Crazy8SelfState | null;
  roundResult: Crazy8RoundResultPayload | null;
  gameOver: Crazy8GameOverPayload | null;
  error: string | null;
  playAgainCode: string | null;
  clearError: () => void;
  consumePlayAgainCode: () => void;
  createRoom: (req: Crazy8CreateRoomReq) => Promise<Crazy8CreateRoomRes>;
  joinRoom: (roomCode: string) => Promise<Crazy8JoinRoomRes>;
  startNow: () => void;
  playCard: (card: Crazy8Card, declaredSuit?: Crazy8Suit) => void;
  drawCards: () => void;
  leaveRoom: () => void;
  playAgain: () => Promise<Crazy8PlayAgainRes>;
}

const Crazy8Context = createContext<Crazy8ContextValue | null>(null);

export function Crazy8Provider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef<string | null>(token);
  const prevTopCardKey = useRef('');
  // The room this client believes it's seated at — used to transparently
  // re-join after a socket reconnect (see the 'connect' handler below).
  const roomCodeRef = useRef<string | null>(null);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<Crazy8PublicRoomState | null>(null);
  const [self, setSelf] = useState<Crazy8SelfState | null>(null);
  const [roundResult, setRoundResult] = useState<Crazy8RoundResultPayload | null>(null);
  const [gameOver, setGameOver] = useState<Crazy8GameOverPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playAgainCode, setPlayAgainCode] = useState<string | null>(null);

  const ensureSocket = useCallback((): Socket => {
    if (socketRef.current) return socketRef.current;
    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: true,
      auth: (cb) => cb({ token: tokenRef.current ?? '' }),
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      // A reconnect is a brand-new server-side socket with NO room bound to
      // it — re-claim our seat or every action would be silently dropped.
      const code = roomCodeRef.current;
      if (code) {
        socket.emit(Crazy8ClientEvents.JoinRoom, { roomCode: code }, (res: Crazy8JoinRoomRes) => {
          if (!res?.ok) setError(res?.error ?? 'Could not rejoin the table');
        });
      }
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on(Crazy8ServerEvents.RoomStateUpdate, (update: Crazy8RoomStateUpdate) => {
      // Play the "placed on felt" sound whenever ANY player's card lands on the
      // discard pile (detected by the top card changing), matching Callbreak's
      // "any play triggers the sound" rule. Skipped outside active play (e.g.
      // a fresh deal) so it doesn't double up with the deal's own flick sound.
      const key = cardKey(update.room.topCard);
      if (update.room.phase === 'playing' && key && key !== prevTopCardKey.current) {
        sound.place();
      }
      prevTopCardKey.current = key;

      roomCodeRef.current = update.room.roomCode;
      setRoom(update.room);
      setSelf(update.self);
      if (update.room.phase !== 'gameOver') setGameOver(null);
    });

    socket.on(Crazy8ServerEvents.RoundResult, (payload: Crazy8RoundResultPayload) => {
      setRoundResult(payload);
    });
    socket.on(Crazy8ServerEvents.GameOver, (payload: Crazy8GameOverPayload) => {
      setGameOver(payload);
    });
    socket.on(Crazy8ServerEvents.ErrorMessage, (payload: { message: string }) => {
      setError(payload.message);
    });
    socket.on(Crazy8ServerEvents.PlayAgainRoom, (payload: { roomCode: string }) => {
      setPlayAgainCode(payload.roomCode);
    });

    return socket;
  }, []);

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  const createRoom = useCallback(
    (req: Crazy8CreateRoomReq) =>
      new Promise<Crazy8CreateRoomRes>((resolve) => {
        const socket = ensureSocket();
        socket.emit(Crazy8ClientEvents.CreateRoom, req, resolve);
      }),
    [ensureSocket],
  );

  const joinRoom = useCallback(
    (roomCode: string) =>
      new Promise<Crazy8JoinRoomRes>((resolve) => {
        const socket = ensureSocket();
        socket.emit(Crazy8ClientEvents.JoinRoom, { roomCode }, resolve);
      }),
    [ensureSocket],
  );

  const startNow = useCallback(() => {
    socketRef.current?.emit(Crazy8ClientEvents.StartNow);
  }, []);

  const playCard = useCallback((card: Crazy8Card, declaredSuit?: Crazy8Suit) => {
    // The "placed on felt" sound fires from the broadcasted state update (see
    // above), not here — that way it plays for every player's turn, not just
    // your own, matching Callbreak's "any play triggers the sound" rule.
    socketRef.current?.emit(Crazy8ClientEvents.PlayCard, { card, declaredSuit });
  }, []);

  const drawCards = useCallback(() => {
    sound.flick();
    socketRef.current?.emit(Crazy8ClientEvents.DrawCards);
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit(Crazy8ClientEvents.LeaveRoom);
    roomCodeRef.current = null;
    setRoom(null);
    setSelf(null);
    setGameOver(null);
    setRoundResult(null);
    prevTopCardKey.current = '';
  }, []);

  const playAgain = useCallback(
    () =>
      new Promise<Crazy8PlayAgainRes>((resolve) => {
        socketRef.current?.emit(Crazy8ClientEvents.PlayAgain, resolve);
      }),
    [],
  );

  const value = useMemo<Crazy8ContextValue>(
    () => ({
      connected,
      room,
      self,
      roundResult,
      gameOver,
      error,
      playAgainCode,
      clearError: () => setError(null),
      consumePlayAgainCode: () => setPlayAgainCode(null),
      createRoom,
      joinRoom,
      startNow,
      playCard,
      drawCards,
      leaveRoom,
      playAgain,
    }),
    [connected, room, self, roundResult, gameOver, error, playAgainCode, createRoom, joinRoom, startNow, playCard, drawCards, leaveRoom, playAgain],
  );

  return <Crazy8Context.Provider value={value}>{children}</Crazy8Context.Provider>;
}

export function useCrazy8(): Crazy8ContextValue {
  const ctx = useContext(Crazy8Context);
  if (!ctx) throw new Error('useCrazy8 must be used within a Crazy8Provider');
  return ctx;
}
