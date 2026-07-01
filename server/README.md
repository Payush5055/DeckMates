# @cardadda/server

Standalone **Node + Socket.io** game server. Holds authoritative Callbreak state
per room (`Map<roomCode, Room>` in memory) and drives the pure `@cardadda/engine`.
Runs as its own process — **not** a serverless function — because WebSockets need
a persistent connection.

## Run

```bash
cp .env.example .env      # optional; sane defaults otherwise
npm run dev               # tsx watch on :4000
# or from repo root:  npm run dev:server
```

## The privacy guarantee

The single most important rule (from the brief): **a client must never receive
another player's hand.** Enforced in one place — [`redact.ts`](src/redact.ts):

- `buildPublicRoomState` → shared table state with per-player **card counts only**.
- `buildSelfState` → exactly one player's own hand + their legal plays.
- `broadcastRoom` sends each socket `{ room, self }` individually.

The integration test `NEVER leaks another player’s hand` deep-scans every
payload to prove only the recipient's own cards appear.

## Socket events

| Direction | Event | Payload |
| --- | --- | --- |
| C→S | `create_room` | `{ playerId, name }` → ack `{ ok, roomCode }` |
| C→S | `join_room` | `{ roomCode, playerId, name }` → ack `{ ok, seat }` |
| C→S | `place_bid` | `{ bid }` |
| C→S | `play_card` | `{ card }` |
| C→S | `leave_room` | — |
| C→S | `play_again` | ack `{ ok, roomCode }` (+ `play_again_room` to others) |
| S→C | `room_state_update` | `{ room: PublicRoomState, self: SelfState }` (personalized) |
| S→C | `round_result` | per-round bids/tricks/scores |
| S→C | `game_over` | final standings (shared-rank) + all rounds |
| S→C | `error_message` | `{ message }` (rule violations, join errors) |

## Behavior notes

- **Auto-start**: the match begins when all four seats are filled and connected.
- **Reconnection**: a dropped player's seat is held for `RECONNECT_GRACE_MS`
  (default 60s); rejoining with the same `playerId` reclaims the exact seat.
  Removal mid-match aborts the room (can't continue fairly with 3).
- **Round pacing**: after a round the engine parks in `roundEnd`; the server
  waits `ROUND_END_DELAY_MS` (default 4s), then deals the next round.
- **Play again**: creates a fresh room, pre-seats the connected players, and
  emits `play_again_room` so their clients navigate over and reconnect.
- **History**: on `game_over` the match is written via a `MatchHistoryStore`.
  Without Supabase creds it uses an in-memory store (works in dev, resets on
  restart); set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to persist. Schema
  in [`supabase/schema.sql`](supabase/schema.sql).

## HTTP endpoints

- `GET /health` — liveness.
- `GET /api/history?playerId=…&limit=…` — match history for the /history tab.
- `GET /api/rooms/:code` — `{ exists, seatsFilled, phase }` for join UX.
