/**
 * Teen Patti domain types and rule constants.
 *
 * Card/Suit/Rank are the shared "card kernel" primitives used by the other
 * engines — reused from `@cardadda/engine`, not redefined.
 */

export type { Card, Suit, Rank } from '@cardadda/engine';
export {
  SUITS,
  RANKS,
  RANK_LABELS,
  SUIT_LABELS,
  cardId,
  sortHand,
} from '@cardadda/engine';

export type Seat = 0 | 1 | 2 | 3 | 4 | 5;

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const BOT_TABLE_SIZE = 4;
export const HAND_SIZE = 3;
export const DEFAULT_BOOT = 1;

export type TeenPattiMode = 'classic' | 'joker' | 'ak47';
export type Visibility = 'blind' | 'seen';
export type HandCategory =
  | 'highCard'
  | 'pair'
  | 'color'
  | 'sequence'
  | 'pureSequence'
  | 'trail';

export const HAND_CATEGORY_LABELS: Readonly<Record<HandCategory, string>> = {
  highCard: 'High card',
  pair: 'Pair',
  color: 'Color',
  sequence: 'Sequence',
  pureSequence: 'Pure sequence',
  trail: 'Trail',
};

export const CATEGORY_STRENGTH: Readonly<Record<HandCategory, number>> = {
  highCard: 0,
  pair: 1,
  color: 2,
  sequence: 3,
  pureSequence: 4,
  trail: 5,
};

export interface HandStrength {
  category: HandCategory;
  /**
   * Category-specific tiebreak vector, compared lexicographically.
   * Bigger is always better.
   */
  tiebreak: number[];
  label: string;
}
