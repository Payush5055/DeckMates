'use client';

/**
 * TableProvider owns the single socket.io connection for the whole app. It lives
 * in the root layout so the connection survives client-side navigation (detail
 * page → table page) without reconnect churn.
 *
 * It exposes the latest personalized state (`room` + your own `self`), the
 * transient round/game-over payloads, and the action emitters. Card-play sounds
 * are triggered here by watching the trick grow across `room_state_update`s.
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
  ClientEvents,
  ServerEvents,
  type Card,
  type CreateRoomRes,
  type GameOverPayload,
  type JoinRoomRes,
  type PlayAgainRes,
  type PublicRoomState,
  type RoomStateUpdate,
  type RoundResultPayload,
  type SelfState,
} from '@cardadda/shared';
import { sound } from './audio';
import { useAuth } from './authContext';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

interface TableContextValue {
  connected: boolean;
  room: PublicRoomState | null;
  self: SelfState | null;
  roundResult: RoundResultPayload | null;
  gameOver: GameOverPayload | null;
  error: string | null;
  playAgainCode: string | null;
  clearError: () => void;
  consumePlayAgainCode: () => void;
  createRoom: () => Promise<CreateRoomRes>;
  joinRoom: (roomCode: string) => Promise<JoinRoomRes>;
  placeBid: (bid: number) => void;
  playCard: (card: Card) => void;
  leaveRoom: () => void;
  playAgain: () => Promise<PlayAgainRes>;
}

const TableContext = createContext<TableContextValue | null>(null);

export function TableProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef<string | null>(token);
  const prevTrickLen = useRef(0);

  // Keep the latest token available to the socket's auth callback (used on every
  // connect/reconnect) without recreating the socket.
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<PublicRoomState | null>(null);
  const [self, setSelf] = useState<SelfState | null>(null);
  const [roundResult, setRoundResult] = useState<RoundResultPayload | null>(null);
  const [gameOver, setGameOver] = useState<GameOverPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playAgainCode, setPlayAgainCode] = useState<string | null>(null);

  /** Lazily create and wire the socket on first use. */
  const ensureSocket = useCallback((): Socket => {
    if (socketRef.current) return socketRef.current;
    const socket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: true,
      // The handshake auth token is resolved fresh on each (re)connect.
      auth: (cb) => cb({ token: tokenRef.current ?? '' }),
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on(ServerEvents.RoomStateUpdate, (update: RoomStateUpdate) => {
      // A card was added to the trick → play the "placed on felt" sound.
      const trickLen = update.room.currentTrick.length;
      if (trickLen > prevTrickLen.current && trickLen > 0) sound.place();
      prevTrickLen.current = trickLen;

      setRoom(update.room);
      setSelf(update.self);
      if (update.room.phase !== 'gameOver') setGameOver(null);
    });

    socket.on(ServerEvents.RoundResult, (payload: RoundResultPayload) => {
      setRoundResult(payload);
    });
    socket.on(ServerEvents.GameOver, (payload: GameOverPayload) => {
      setGameOver(payload);
    });
    socket.on(ServerEvents.ErrorMessage, (payload: { message: string }) => {
      setError(payload.message);
    });
    socket.on(ServerEvents.PlayAgainRoom, (payload: { roomCode: string }) => {
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
    () =>
      new Promise<CreateRoomRes>((resolve) => {
        const socket = ensureSocket();
        // Identity comes from the authenticated handshake — no payload needed.
        socket.emit(ClientEvents.CreateRoom, resolve);
      }),
    [ensureSocket],
  );

  const joinRoom = useCallback(
    (roomCode: string) =>
      new Promise<JoinRoomRes>((resolve) => {
        const socket = ensureSocket();
        socket.emit(ClientEvents.JoinRoom, { roomCode }, resolve);
      }),
    [ensureSocket],
  );

  const placeBid = useCallback((bid: number) => {
    socketRef.current?.emit(ClientEvents.PlaceBid, { bid });
  }, []);

  const playCard = useCallback((card: Card) => {
    socketRef.current?.emit(ClientEvents.PlayCard, { card });
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit(ClientEvents.LeaveRoom);
    setRoom(null);
    setSelf(null);
    setGameOver(null);
    setRoundResult(null);
    prevTrickLen.current = 0;
  }, []);

  const playAgain = useCallback(
    () =>
      new Promise<PlayAgainRes>((resolve) => {
        socketRef.current?.emit(ClientEvents.PlayAgain, resolve);
      }),
    [],
  );

  const value = useMemo<TableContextValue>(
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
      placeBid,
      playCard,
      leaveRoom,
      playAgain,
    }),
    [connected, room, self, roundResult, gameOver, error, playAgainCode, createRoom, joinRoom, placeBid, playCard, leaveRoom, playAgain],
  );

  return <TableContext.Provider value={value}>{children}</TableContext.Provider>;
}

export function useTable(): TableContextValue {
  const ctx = useContext(TableContext);
  if (!ctx) throw new Error('useTable must be used within a TableProvider');
  return ctx;
}
