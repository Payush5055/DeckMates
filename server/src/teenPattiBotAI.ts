/**
 * Teen Patti bot AI — deliberately stronger than the other three games'
 * baseline heuristics, since real (even if virtual) money is at stake here.
 *
 * Every decision is driven by a single normalized [0, 1] hand-strength score
 * (dominant hand category, scaled by rank within that category), rather than
 * a fixed lookup table, so bet sizing/fold/show all scale continuously with
 * genuine hand quality instead of jumping between a few hard tiers.
 *
 * Root cause of the earlier "bots never see their cards" bug: the old code
 * only called `seeCards` once `currentStake` climbed to `boot * 3`, but a bot
 * betting the floor on a weak hand (the ~91% common case: pair/high-card)
 * left `currentStake` completely unchanged, so the threshold was rarely if
 * ever reached — bots would blind-bet the minimum forever. This version
 * decouples "when to look" from the stake entirely: a blind bot rolls to
 * look on every one of its turns, so it converges to seen within a few turns
 * regardless of how the betting is going.
 */

import {
  canRequestShow,
  CATEGORY_STRENGTH,
  evaluateSeatHand,
  getBetBounds,
  getSideShowTarget,
  isBlind,
  type GameState,
  type Seat,
} from '@cardadda/teenpatti-engine';

export type BotAction =
  | { action: 'see' }
  | { action: 'fold' }
  | { action: 'show' }
  | { action: 'sideShow' }
  | { action: 'bet'; amount: number };

/** Chance a still-blind bot looks at its cards on any given one of its turns. */
const LOOK_PROBABILITY_PER_BLIND_TURN = 0.45;
/** Chance a turn is a deliberate bluff — bet aggressively despite a weak/medium hand. */
const BLUFF_PROBABILITY = 0.12;

/**
 * Normalized [0, 1] hand strength: the dominant category (trail highest, high
 * card lowest) contributes most of the score, plus a within-category
 * fraction derived from the engine's own tiebreak vector so, e.g., a
 * king-high pair scores higher than a four-high pair.
 */
function handStrength(state: GameState, seat: Seat): number {
  const { category, tiebreak } = evaluateSeatHand(state, seat);
  const tier = CATEGORY_STRENGTH[category]; // 0 (highCard) .. 5 (trail)
  const primary = tiebreak[0] ?? 2;
  const fraction = Math.min(1, Math.max(0, (primary - 2) / 12)); // rank 2..14 -> 0..1
  return (tier + fraction) / 6;
}

/**
 * Round a bet to a whole rupee, and to an even amount when seen (a seen bet
 * halves into the next stake, so an odd seen bet would drift the stake into
 * fractional rupees).
 */
function roundBet(amount: number, seen: boolean): number {
  return seen ? Math.round(amount / 2) * 2 : Math.round(amount);
}

export function chooseAction(state: GameState, seat: Seat, rng: () => number = Math.random): BotAction {
  const strength = handStrength(state, seat);
  const blind = isBlind(state, seat);

  // Look reasonably early — every blind turn gets an independent roll, so
  // staying blind for many consecutive turns becomes vanishingly unlikely
  // (this can never get "stuck" the way a stake-gated threshold could).
  if (blind && rng() < LOOK_PROBABILITY_PER_BLIND_TURN) {
    return { action: 'see' };
  }

  // Show/side-show force an immediate reveal of real cards — scale strictly
  // to genuine confidence, never to a bluff (a bluffed show just loses on
  // the spot, since there is no opponent left to fold from the reveal).
  if (canRequestShow(state, seat) && strength >= 0.45) {
    return { action: 'show' };
  }
  const sideShowTarget = getSideShowTarget(state, seat);
  if (sideShowTarget !== null && strength >= 0.55) {
    return { action: 'sideShow' };
  }

  const bluffing = rng() < BLUFF_PROBABILITY;

  // Real fold logic: a genuinely weak hand facing an escalating stake folds,
  // unless this turn happens to be a deliberate bluff. Blind bets are cheap
  // (min = current stake), so there's no urgency to fold while still blind
  // unless the stake has already escalated well past the boot.
  if (!bluffing) {
    if (!blind && strength < 0.2 && rng() < 0.7) return { action: 'fold' };
    if (blind && strength < 0.1 && state.currentStake > state.boot * 4 && rng() < 0.5) {
      return { action: 'fold' };
    }
    // Anything short of a genuinely strong hand eventually folds once the pot
    // has gotten expensive relative to the boot. Without this, a table where
    // everyone holds a middling hand (too good to give up cheaply, not good
    // enough to raise) can otherwise call the same minimum forever — this is
    // what guarantees a hand always converges instead of stalling.
    if (strength < 0.65 && state.currentStake > state.boot * 8 && rng() < 0.5) {
      return { action: 'fold' };
    }
  }

  const { min, max } = getBetBounds(state, seat);
  const effectiveStrength = bluffing ? Math.max(strength, 0.75) : strength;
  const span = max - min;

  let raw: number;
  if (effectiveStrength >= 0.65) raw = max; // trail / pure sequence: push the max
  else if (effectiveStrength >= 0.4) raw = min + span * 0.6; // sequence / decent color: bet moderately
  else raw = min; // weak: minimal

  const amount = Math.min(max, Math.max(min, roundBet(raw, state.seen[seat]!)));
  return { action: 'bet', amount };
}

/**
 * Decide whether to accept a side-show request. Scales to genuine
 * confidence, with a small chance of accepting anyway with a middling hand
 * so the bot isn't purely readable as "only accepts with a lock".
 */
export function chooseSideShowResponse(state: GameState, seat: Seat, rng: () => number = Math.random): boolean {
  const strength = handStrength(state, seat);
  if (strength >= 0.4) return true;
  return rng() < 0.15;
}
