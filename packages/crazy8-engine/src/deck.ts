/**
 * Deck creation, dealing, and the draw/discard pile mechanics specific to
 * Crazy 8s. Reuses `createDeck`/`shuffle` (the standard 52-card kernel) from
 * `@cardadda/engine` rather than rebuilding them.
 */

import { createDeck, shuffle, type RNG } from '@cardadda/engine';
import { handSizeFor, WILD_RANK, type Card } from './types';

export type { RNG } from '@cardadda/engine';

export interface InitialDeal {
  /** One hand per player, length `numPlayers`. */
  hands: Card[][];
  drawPile: Card[];
  /** The starting discard-pile card. Never an 8 (see reshuffle rule below). */
  topCard: Card;
}

/**
 * Deal a fresh round: round-robin deal (hand size by player count — 7 for 2
 * players, 5 for 3–4), then flip the top of the remaining draw pile to start
 * the discard pile.
 *
 * If the very first flip is an 8, it is reshuffled back into the draw pile and
 * a new card is flipped instead — avoids any ambiguity about who "declares" a
 * suit for a card nobody actually played (locked decision for this build).
 */
export function dealInitial(numPlayers: number, rng: RNG = Math.random): InitialDeal {
  const handSize = handSizeFor(numPlayers);
  const deck = shuffle(createDeck(), rng);

  const hands: Card[][] = Array.from({ length: numPlayers }, () => []);
  let i = 0;
  for (let round = 0; round < handSize; round++) {
    for (let p = 0; p < numPlayers; p++) {
      hands[p]!.push(deck[i]!);
      i++;
    }
  }

  let rest = deck.slice(i);
  let topCard = rest.pop()!;
  while (topCard.rank === WILD_RANK) {
    rest = shuffle([...rest, topCard], rng);
    topCard = rest.pop()!;
  }

  return { hands, drawPile: rest, topCard };
}

/**
 * Reshuffle the discard pile (everything except its current top card) into a
 * fresh draw pile. Called when the draw pile runs dry mid-round — standard
 * behavior for any draw/discard-pile card game so a long round never stalls.
 *
 * Returns the new draw pile and the discard pile trimmed down to just the top
 * card (the only piece of history that must survive the reshuffle).
 */
export function reshuffleDiscardIntoDraw(
  discardPile: readonly Card[],
  rng: RNG = Math.random,
): { drawPile: Card[]; discardPile: Card[] } {
  if (discardPile.length <= 1) {
    // Nothing beneath the top card to reshuffle — genuinely no cards left.
    return { drawPile: [], discardPile: discardPile.slice() };
  }
  const top = discardPile[discardPile.length - 1]!;
  const rest = discardPile.slice(0, -1);
  return { drawPile: shuffle(rest, rng), discardPile: [top] };
}
