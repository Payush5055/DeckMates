# @cardadda/engine

Pure, framework-independent **Callbreak rule engine**. No React or Socket.io
imports — it's just deck logic, trick resolution, scoring, and a game state
machine. Unit-tested in isolation and reusable when we add more games later.

## Modules

| File          | Responsibility                                                        |
| ------------- | --------------------------------------------------------------------- |
| `types.ts`    | Domain types (`Card`, `Suit`, `Rank`, `Seat`) and rule constants.     |
| `deck.ts`     | `createDeck`, `shuffle` (injectable RNG), `deal`, `createShuffledHands`. |
| `trick.ts`    | `isLegalPlay`, `legalPlays`, `resolveTrick` (spades-trump).           |
| `scoring.ts`  | `roundScoreTenths`, `rankSeats`, display helpers.                     |
| `game.ts`     | `createGame`, `placeBid`, `playCard`, `startNextRound` state machine. |

## Rule decisions locked for this build

These were the ambiguous points; confirmed with product before implementation:

- **No nil/zero bid.** Bids are whole numbers **1–8** (`MIN_BID`/`MAX_BID`).
- **Relaxed follow-suit.** You must follow the lead suit only if you hold it;
  otherwise any card is legal (no forced "must beat", no forced trump when void).
- **Spades are always trump** for *winning* a trick: highest spade wins; with no
  spade, the highest card of the lead suit wins.
- **Scoring** (kept as integer **tenths** internally to avoid float drift):
  - Bid met (`won >= bid`): `bid` points `+ 0.1` per overtrick → `bid*10 + (won-bid)` tenths.
  - Bid missed: `-bid` points → `-(bid*10)` tenths.
  - Display via `formatPoints` → e.g. `3.2`, `-3.0`.
- **5 rounds**, dealer rotates clockwise each round; first bidder/leader sits to
  the dealer's left.
- **Ties share rank** (competition ranking: `1, 1, 3, 4`) via `rankSeats`.

## Privacy contract

`GameState.hands` is **private**. The server must never broadcast raw hands — it
sends each player only their own hand plus shared public table state. The engine
holds all four hands; redaction is the transport layer's job (Milestone 2).

## Scripts

```bash
npm test         # run the vitest suite (41 tests)
npm run typecheck # tsc --noEmit, strict mode
```
