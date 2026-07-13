import { createDeck, type Card, type Rank } from '@cardadda/engine';
import {
  CATEGORY_STRENGTH,
  HAND_CATEGORY_LABELS,
  type HandCategory,
  type HandStrength,
  type TeenPattiMode,
} from './types';

const ALL_CARDS: readonly Card[] = createDeck();

function compareVectors(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    if (av !== bv) return av > bv ? 1 : -1;
  }
  return 0;
}

function strength(
  category: HandCategory,
  tiebreak: number[],
  label: string = HAND_CATEGORY_LABELS[category],
): HandStrength {
  return { category, tiebreak, label };
}

function isWild(card: Card, mode: TeenPattiMode, jokerRank: Rank | null): boolean {
  if (mode === 'classic') return false;
  if (mode === 'joker') return jokerRank !== null && card.rank === jokerRank;
  return card.rank === 14 || card.rank === 13 || card.rank === 7 || card.rank === 4;
}

function sequenceHigh(ranks: readonly number[]): number | null {
  const asc = [...ranks].sort((a, b) => a - b);
  if (new Set(asc).size !== asc.length) return null;
  if (asc[0]! + 1 === asc[1]! && asc[1]! + 1 === asc[2]!) return asc[2]!;
  if (asc[0] === 2 && asc[1] === 3 && asc[2] === 14) return 3;
  return null;
}

function highCardsDescending(cards: readonly Card[]): number[] {
  return cards.map((c) => c.rank).sort((a, b) => b - a);
}

function describeRanks(ranks: readonly number[]): string {
  return ranks.join('-');
}

function evaluateConcrete(cards: readonly Card[]): HandStrength {
  const ranks = cards.map((c) => c.rank);
  const suits = cards.map((c) => c.suit);
  const sameSuit = suits.every((s) => s === suits[0]);
  const counts = new Map<number, number>();
  for (const rank of ranks) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const sortedCounts = [...counts.entries()].sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));
  const seqHigh = sequenceHigh(ranks);
  const desc = highCardsDescending(cards);

  if (sortedCounts[0]?.[1] === 3) {
    const tripleRank = sortedCounts[0][0];
    return strength('trail', [tripleRank], `${HAND_CATEGORY_LABELS.trail} (${tripleRank}s)`);
  }
  if (seqHigh !== null && sameSuit) {
    return strength('pureSequence', [seqHigh], `${HAND_CATEGORY_LABELS.pureSequence} (${describeRanks(desc)})`);
  }
  if (seqHigh !== null) {
    return strength('sequence', [seqHigh], `${HAND_CATEGORY_LABELS.sequence} (${describeRanks(desc)})`);
  }
  if (sameSuit) {
    return strength('color', desc, `${HAND_CATEGORY_LABELS.color} (${describeRanks(desc)})`);
  }
  if (sortedCounts[0]?.[1] === 2) {
    const pairRank = sortedCounts[0][0];
    const kicker = sortedCounts[1]![0];
    return strength('pair', [pairRank, kicker], `${HAND_CATEGORY_LABELS.pair} (${pairRank}s)`);
  }
  return strength('highCard', desc, `${HAND_CATEGORY_LABELS.highCard} (${describeRanks(desc)})`);
}

function concreteVariants(cards: readonly Card[], mode: TeenPattiMode, jokerRank: Rank | null): Card[][] {
  const wildIndexes = cards
    .map((card, index) => (isWild(card, mode, jokerRank) ? index : -1))
    .filter((index) => index >= 0);
  if (wildIndexes.length === 0) return [cards.slice() as Card[]];

  const out: Card[][] = [];
  const base = cards.slice() as Card[];

  function walk(i: number) {
    if (i >= wildIndexes.length) {
      out.push(base.slice());
      return;
    }
    const index = wildIndexes[i]!;
    for (const candidate of ALL_CARDS) {
      base[index] = candidate;
      walk(i + 1);
    }
  }

  walk(0);
  return out;
}

export function compareStrength(a: HandStrength, b: HandStrength): number {
  const cat = CATEGORY_STRENGTH[a.category] - CATEGORY_STRENGTH[b.category];
  if (cat !== 0) return cat > 0 ? 1 : -1;
  return compareVectors(a.tiebreak, b.tiebreak);
}

export function evaluateHand(
  cards: readonly Card[],
  mode: TeenPattiMode,
  jokerRank: Rank | null,
): HandStrength {
  if (cards.length !== 3) {
    throw new Error(`evaluateHand expects exactly 3 cards, got ${cards.length}`);
  }

  let best: HandStrength | null = null;
  for (const variant of concreteVariants(cards, mode, jokerRank)) {
    const current = evaluateConcrete(variant);
    if (!best || compareStrength(current, best) > 0) best = current;
  }
  return best!;
}

export function compareHands(
  a: readonly Card[],
  b: readonly Card[],
  mode: TeenPattiMode,
  jokerRank: Rank | null,
): number {
  return compareStrength(evaluateHand(a, mode, jokerRank), evaluateHand(b, mode, jokerRank));
}
