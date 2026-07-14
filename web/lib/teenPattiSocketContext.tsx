'use client';

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
  TeenPattiClientEvents,
  TeenPattiServerEvents,
  type TeenPattiBetReq,
  type TeenPattiCreateRoomReq,
  type TeenPattiCreateRoomRes,
  type TeenPattiGameOverPayload,
  type TeenPattiJoinRoomRes,
  type TeenPattiPlayAgainRes,
  type TeenPattiPublicRoomState,
  type TeenPattiRoomStateUpdate,
  type TeenPattiSessionSettledPayload,
  type TeenPattiSideShowResReq,
  type TeenPattiSelfState,
} from '@cardadda/shared';
import { useAuth } from './authContext';

const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000';

interface TeenPattiContextValue {
  connected: boolean;
  room: TeenPattiPublicRoomState | null;
  self: TeenPattiSelfState | null;
  gameOver: TeenPattiGameOverPayload | null;
  sessionSettled: TeenPattiSessionSettledPayload | null;
  error: string | null;
  playAgainCode: string | null;
  clearError: () => void;
  clearSessionSettled: () => void;
  consumePlayAgainCode: () => void;
  createRoom: (req: TeenPattiCreateRoomReq) => Promise<TeenPattiCreateRoomRes>;
  joinRoom: (roomCode: string) => Promise<TeenPattiJoinRoomRes>;
  startNow: () => void;
  seeCards: () => void;
  bet: (req: TeenPattiBetReq) => void;
  fold: () => void;
  requestShow: () => void;
  requestSideShow: () => void;
  respondSideShow: (req: TeenPattiSideShowResReq) => void;
  leaveRoom: () => void;
  playAgain: () => Promise<TeenPattiPlayAgainRes>;
}

const TeenPattiContext = createContext<TeenPattiContextValue | null>(null);

export function TeenPattiProvider({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  const socketRef = useRef<Socket | null>(null);
  const tokenRef = useRef<string | null>(token);
  // The room this client believes it's seated at — used to transparently
  // re-join after a socket reconnect (see the 'connect' handler below).
  const roomCodeRef = useRef<string | null>(null);

  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState<TeenPattiPublicRoomState | null>(null);
  const [self, setSelf] = useState<TeenPattiSelfState | null>(null);
  const [gameOver, setGameOver] = useState<TeenPattiGameOverPayload | null>(null);
  const [sessionSettled, setSessionSettled] = useState<TeenPattiSessionSettledPayload | null>(null);
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
        socket.emit(TeenPattiClientEvents.JoinRoom, { roomCode: code }, (res: TeenPattiJoinRoomRes) => {
          if (!res?.ok) setError(res?.error ?? 'Could not rejoin the table');
        });
      }
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on(TeenPattiServerEvents.RoomStateUpdate, (update: TeenPattiRoomStateUpdate) => {
      roomCodeRef.current = update.room.roomCode;
      setRoom(update.room);
      setSelf(update.self);
      if (update.room.phase !== 'gameOver') setGameOver(null);
    });
    socket.on(TeenPattiServerEvents.GameOver, (payload: TeenPattiGameOverPayload) => {
      setGameOver(payload);
    });
    socket.on(TeenPattiServerEvents.SessionSettled, (payload: TeenPattiSessionSettledPayload) => {
      setSessionSettled(payload);
    });
    socket.on(TeenPattiServerEvents.ErrorMessage, (payload: { message: string }) => {
      setError(payload.message);
    });
    socket.on(TeenPattiServerEvents.PlayAgainRoom, (payload: { roomCode: string }) => {
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
    (req: TeenPattiCreateRoomReq) =>
      new Promise<TeenPattiCreateRoomRes>((resolve) => {
        ensureSocket().emit(TeenPattiClientEvents.CreateRoom, req, resolve);
      }),
    [ensureSocket],
  );

  const joinRoom = useCallback(
    (roomCode: string) =>
      new Promise<TeenPattiJoinRoomRes>((resolve) => {
        ensureSocket().emit(TeenPattiClientEvents.JoinRoom, { roomCode }, resolve);
      }),
    [ensureSocket],
  );

  const startNow = useCallback(() => {
    socketRef.current?.emit(TeenPattiClientEvents.StartNow);
  }, []);

  const seeCards = useCallback(() => {
    socketRef.current?.emit(TeenPattiClientEvents.SeeCards);
  }, []);

  const bet = useCallback((req: TeenPattiBetReq) => {
    socketRef.current?.emit(TeenPattiClientEvents.Bet, req);
  }, []);

  const foldAction = useCallback(() => {
    socketRef.current?.emit(TeenPattiClientEvents.Fold);
  }, []);

  const requestShow = useCallback(() => {
    socketRef.current?.emit(TeenPattiClientEvents.RequestShow);
  }, []);

  const requestSideShow = useCallback(() => {
    socketRef.current?.emit(TeenPattiClientEvents.RequestSideShow);
  }, []);

  const respondSideShow = useCallback((req: TeenPattiSideShowResReq) => {
    socketRef.current?.emit(TeenPattiClientEvents.RespondSideShow, req);
  }, []);

  const leaveRoom = useCallback(() => {
    socketRef.current?.emit(TeenPattiClientEvents.LeaveRoom);
    roomCodeRef.current = null; // we left on purpose — never auto-rejoin
    setGameOver(null);
    // Deliberately NOT clearing room/self here — the session-settled summary
    // (if any) still needs a seat/room context to render against; the table
    // view clears these itself once the player dismisses that summary.
  }, []);

  const playAgain = useCallback(
    () =>
      new Promise<TeenPattiPlayAgainRes>((resolve) => {
        socketRef.current?.emit(TeenPattiClientEvents.PlayAgain, resolve);
      }),
    [],
  );

  const value = useMemo<TeenPattiContextValue>(
    () => ({
      connected,
      room,
      self,
      gameOver,
      sessionSettled,
      error,
      playAgainCode,
      clearError: () => setError(null),
      clearSessionSettled: () => setSessionSettled(null),
      consumePlayAgainCode: () => setPlayAgainCode(null),
      createRoom,
      joinRoom,
      startNow,
      seeCards,
      bet,
      fold: foldAction,
      requestShow,
      requestSideShow,
      respondSideShow,
      leaveRoom,
      playAgain,
    }),
    [
      connected,
      room,
      self,
      gameOver,
      sessionSettled,
      error,
      playAgainCode,
      createRoom,
      joinRoom,
      startNow,
      seeCards,
      bet,
      foldAction,
      requestShow,
      requestSideShow,
      respondSideShow,
      leaveRoom,
      playAgain,
    ],
  );

  return <TeenPattiContext.Provider value={value}>{children}</TeenPattiContext.Provider>;
}

export function useTeenPatti(): TeenPattiContextValue {
  const ctx = useContext(TeenPattiContext);
  if (!ctx) throw new Error('useTeenPatti must be used within a TeenPattiProvider');
  return ctx;
}
