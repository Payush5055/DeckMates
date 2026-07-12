'use client';

/**
 * ThirtyOneProvider — a third, independent socket.io connection dedicated to
 * 31's events, mirroring crazy8SocketContext exactly. Created lazily on first
 * action so players who never open a 31 table never pay for it.
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
  ThirtyOneClientEvents,
  ThirtyOneServerEvents,
  type ThirtyOneCard,
  type ThirtyOneCreateRoomReq,
  type ThirtyOneCreateRoomRes,
  type ThirtyOneGameOverPayload,
  type ThirtyOneJoinRoomRes,
  type ThirtyOnePlayAgainRes,
  type ThirtyOnePublicRoomState,
  type ThirtyOneRoomStateUpdate,
  type ThirtyOneRoundResultPayload,
  type ThirtyOneSelfState,
} from '@cardadda/shared';
import { sound } from './audio';
import { useAuth } from './authContext';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

function cardKey(card: ThirtyOneCard | null): string {
  return card ? `${card.suit}${card.rank}` : '';
}

interface ThirtyOneContextValue {
  connected: boolean;
  room: ThirtyOnePublicRoomState | null;
  self: ThirtyOneSelfState | null;
  roundResult: ThirtyOneRoundResultPayload | null;
  gameOver: ThirtyOneGameOverPayload | null;
  error: string | null;
  playAgainCode: string | null;
  clearError: () => void;
  consumePlayAgainCode: () => void;
  createRoom: (req: ThirtyOneCreateRoomReq) => Promise<ThirtyOneCreateRoomRes>;
  joinRoom: (roomCode: string) => Promise<ThirtyOneJoinRoomRes>;
  knock: () => void;
  drawCard: (source: 'pile' | 'discard') => void;
  discardCard: (card: ThirtyOneCard) => void;
  leaveRoom: () => void;
  playAgain: () => Promise<ThirtyOnePlayAgainRes>;
}

const ThirtyOneContext = createContext<ThirtyOneContextValue | null>(null);

export function ThirtyOneProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef<string | null>(token);
  const prevTopKey = useRef('');

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<ThirtyOnePublicRoomState | null>(null);
  const [self, setSelf] = useState<ThirtyOneSelfState | null>(null);
  const [roundResult, setRoundResult] = useState<ThirtyOneRoundResultPayload | null>(null);
  const [gameOver, setGameOver] = useState<ThirtyOneGameOverPayload | null>(null);
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

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on(ThirtyOneServerEvents.RoomStateUpdate, (update: ThirtyOneRoomStateUpdate) => {
      // "Placed on felt" whenever the top discard changes during active play —
      // covers every player's discards, matching the other games' sound rule.
      const key = cardKey(update.room.topDiscard);
      if (update.room.phase === 'playing' && key && key !== prevTopKey.current) {
        sound.place();
      }
      prevTopKey.current = key;

      setRoom(update.room);
      setSelf(update.self);
      if (update.room.phase !== 'gameOver') setGameOver(null);
    });

    socket.on(ThirtyOneServerEvents.RoundResult, (payload: ThirtyOneRoundResultPayload) => {
      setRoundResult(payload);
    });
    socket.on(ThirtyOneServerEvents.GameOver, (payload: ThirtyOneGameOverPayload) => {
      setGameOver(payload);
    });
    socket.on(ThirtyOneServerEvents.ErrorMessage, (payload: { message: string }) => {
      setError(payload.message);
    });
    socket.on(ThirtyOneServerEvents.PlayAgainRoom, (payload: { roomCode: string }) => {
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
    (req: ThirtyOneCreateRoomReq) =>
      new Promise<ThirtyOneCreateRoomRes>((resolve) => {
        ensureSocket().emit(ThirtyOneClientEvents.CreateRoom, req, resolve);
      }),
    [ensureSocket],
  );

  const joinRoom = useCallback(
    (roomCode: string) =>
      new Promise<ThirtyOneJoinRoomRes>((resolve) => {
        ensureSocket().emit(ThirtyOneClientEvents.JoinRoom, { roomCode }, resolve);
      }),
    [ensureSocket],
  );

  const knock = useCallback(() => {
    socketRef.current?.emit(ThirtyOneClientEvents.Knock);
  }, []);

  const drawCard = useCallback((source: 'pile' | 'discard') => {
    sound.flick();
    socketRef.current?.emit(ThirtyOneClientEvents.DrawCard, { source });
  }, []);

  const discardCard = useCallback((card: ThirtyOneCard) => {
    socketRef.current?.emit(ThirtyOneClientEvents.DiscardCard, { card });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit(ThirtyOneClientEvents.LeaveRoom);
    setRoom(null);
    setSelf(null);
    setGameOver(null);
    setRoundResult(null);
    prevTopKey.current = '';
  }, []);

  const playAgain = useCallback(
    () =>
      new Promise<ThirtyOnePlayAgainRes>((resolve) => {
        socketRef.current?.emit(ThirtyOneClientEvents.PlayAgain, resolve);
      }),
    [],
  );

  const value = useMemo<ThirtyOneContextValue>(
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
      knock,
      drawCard,
      discardCard,
      leaveRoom,
      playAgain,
    }),
    [connected, room, self, roundResult, gameOver, error, playAgainCode, createRoom, joinRoom, knock, drawCard, discardCard, leaveRoom, playAgain],
  );

  return <ThirtyOneContext.Provider value={value}>{children}</ThirtyOneContext.Provider>;
}

export function useThirtyOne(): ThirtyOneContextValue {
  const ctx = useContext(ThirtyOneContext);
  if (!ctx) throw new Error('useThirtyOne must be used within a ThirtyOneProvider');
  return ctx;
}
