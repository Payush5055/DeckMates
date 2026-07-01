# DeckMates — Callbreak (v1)

A web-based multiplayer card platform. v1 ships one polished, fully-working game:
**Callbreak**, 4-player, real-time, inside a Netflix-style browse shell.

> The repo/workspace dirs are named `cardadda` (original codename); the product
> is branded **DeckMates** in the UI.

## Monorepo layout

```
packages/engine   Pure Callbreak rule engine (no framework imports). Unit-tested.
packages/shared   Wire contract: socket event names + redacted view/payload types.
server            Standalone Node + Socket.io game server (authoritative state).
web               Next.js 14 App Router UI (Tailwind + Framer Motion).
```

Built in three milestones: (1) rule engine + tests, (2) Socket.io layer, (3) UI.

## Run it locally

```bash
npm install

# Terminal 1 — game server on :4000
npm run dev:server

# Terminal 2 — web app on :3000
npm run dev:web
```

Open http://localhost:3000. **Accounts are required** — you'll be sent to
`/login`. With the dev bypass enabled (`DEV_AUTH=1` / `NEXT_PUBLIC_DEV_AUTH=1`,
the default in the example env), sign in as a "test user" by picking any
username. To play a full 4-seat game on one machine, open four browser tabs and
sign in with a different username in each.

Config: copy `server/.env.example` → `server/.env` and `web/.env.local.example`
→ `web/.env.local`. For real Google sign-in, follow **[SETUP_AUTH.md](SETUP_AUTH.md)**.

## Test & typecheck

```bash
npm test        # 48 tests (41 engine + 7 server integration)
npm run typecheck
```

## Locked Callbreak rules (v1)

- Bids **1–8**, no nil. Spades always trump.
- Relaxed follow-suit: follow the lead suit if you can; otherwise play anything.
- Scoring (stored as integer tenths, shown as decimals like `3.2`): made bid =
  `bid + 0.1 × overtricks`; missed = `−bid`.
- 5 rounds; final ranking uses **shared rank** on ties.

See `packages/engine/README.md` for engine details and `server/README.md` for the
socket contract and the privacy guarantee (no client ever receives another
player's hand).

## Auth & Supabase

Sign-in is **Google OAuth via Supabase Auth**; on first sign-in you pick a
unique username (DB-`UNIQUE`-enforced). The Socket.io server verifies the
Supabase access token on every connection and derives identity server-side — a
client can never claim another user (`server/src/auth.ts`). Full setup
(Google Cloud + Supabase provider + SQL) is in **[SETUP_AUTH.md](SETUP_AUTH.md)**.

Until that's configured, the **dev bypass** lets you run everything locally.
Match history keys off the authenticated user id and persists to Supabase when
configured (in-memory otherwise; resets on restart) — apply
`server/supabase/schema.sql` (creates both the `profiles` and `matches` tables).

## Extension points (intentionally left clean for later)

- **More games:** the browse grid already renders grayed "Coming soon" cards; the
  pure engine pattern in `packages/engine` is meant to be duplicated per game.
- **Auth backends:** identity flows through `AuthProvider` (web) and
  `verifyToken` (server); add providers or replace the dev bypass without
  touching the rule engine or game logic.
