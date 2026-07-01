// Dev-only: connect three autonomous bots to a room so a full game can be
// exercised end-to-end. Usage: node scripts/bots.mjs <ROOMCODE>
import { io } from 'socket.io-client';

const URL = process.env.SOCKET_URL ?? 'http://localhost:4000';
const code = process.argv[2];
if (!code) {
  console.error('usage: node scripts/bots.mjs <ROOMCODE>');
  process.exit(1);
}

const BOTS = ['bot-1', 'bot-2', 'bot-3'];

for (const pid of BOTS) {
  const s = io(URL, { transports: ['websocket'], forceNew: true });
  const acted = new Set();

  s.on('connect', () => {
    s.emit('join_room', { roomCode: code, playerId: pid, name: pid }, (res) => {
      if (!res?.ok) console.log(`${pid} join failed:`, res?.error);
    });
  });

  s.on('room_state_update', ({ room, self }) => {
    if (!self) return;
    // Include tricks-completed and our own hand size so leading two different
    // tricks (same seat, empty trick) produces distinct keys.
    const done = room.players.reduce((n, p) => n + p.tricksWon, 0);
    const key = `${room.roundNumber}:${room.phase}:${room.turn}:${room.currentTrick.length}:${done}:${self.hand.length}`;
    if (acted.has(key)) return;

    if (room.phase === 'bidding' && room.turn === self.seat) {
      acted.add(key);
      const strong = self.hand.filter((c) => c.suit === 'S' || c.rank >= 12).length;
      const bid = Math.max(1, Math.min(8, strong || 1));
      s.emit('place_bid', { bid });
    } else if (room.phase === 'playing' && room.turn === self.seat) {
      acted.add(key);
      const card = self.legalPlays[0];
      if (card) setTimeout(() => s.emit('play_card', { card }), 250);
    }
  });

  s.on('game_over', () => console.log(`${pid} saw game over`));
  s.on('error_message', (m) => console.log(`${pid} error:`, m.message));
}

console.log(`3 bots joining ${code} at ${URL}`);
// Keep the process alive through the match.
setTimeout(() => process.exit(0), 300000);
