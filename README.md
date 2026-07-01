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

Open http://localhost:3000. To play a full 4-seat game on one machine, open the
table link in four browser tabs/windows (each gets its own persistent player id).

Config: copy `server/.env.example` → `server/.env` and `web/.env.local.example`
→ `web/.env.local` if you need non-default ports or Supabase.

## Test & typecheck

```bash
npm test        # 47 tests (41 engine + 6 server integration)
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

## Supabase (optional, for history)

History works out of the box via an in-memory store (resets on server restart).
To persist: set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `server/.env` and
apply `server/supabase/schema.sql`. No code change needed.

## Extension points (intentionally left clean for later)

- **More games:** the browse grid already renders grayed "Coming soon" cards; the
  pure engine pattern in `packages/engine` is meant to be duplicated per game.
- **Accounts/auth:** identity is a browser-persisted player id today; swap for
  real auth without touching the rule engine.
