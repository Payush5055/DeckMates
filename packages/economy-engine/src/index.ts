/**
 * Pure virtual-money economy math shared by every game's persistent wallet.
 *
 * Every user has one persistent permanent balance. A Teen Patti *session* (one
 * continuous stay at a table, across many hands) adds a flat top-up on top of
 * that balance to play with; when the session ends, `settleTeenPattiSession`
 * decides how much of the session's outcome converts back into the permanent
 * balance. The other three games have no session/top-up concept — they pay a
 * one-off delta straight into the permanent balance at game end, computed by
 * the `*PayoutDelta` functions below.
 *
 * No I/O, no persistence, no framework imports — every function here is a
 * deterministic calculation over plain numbers so it can be unit tested
 * exhaustively and reused identically on the server (the only place these
 * numbers are trusted) and, read-only, on the client for display/preview.
 */

/** Starting permanent balance granted to a brand-new user. */
export const STARTING_BALANCE = 100_000;

/** Flat top-up granted at the start of every Teen Patti session. */
export const SESSION_TOPUP = 100_000;

/** Single-tier boot (ante) size for Teen Patti, in rupees. */
export const TEENPATTI_BOOT = 200;

/**
 * Marginal wagering-requirement brackets applied to a session's total
 * bankroll (permanent + top-up), the same way income-tax brackets work: each
 * bracket's rate applies only to the slice of balance within it.
 */
const BRACKETS = [
  { upTo: 100_000, rate: 0.8 },
  { upTo: Infinity, rate: 0.35 },
] as const;

/**
 * The cumulative amount a player must wager in a session before any profit
 * becomes eligible to convert into their permanent balance. Never gates
 * losses or the ability to leave — see `settleTeenPattiSession`.
 */
export function requiredWagerAmount(bankroll: number): number {
  if (bankroll <= 0) return 0;
  let remaining = bankroll;
  let required = 0;
  let floor = 0;
  for (const bracket of BRACKETS) {
    const sliceTop = bracket.upTo;
    const sliceSize = Math.min(remaining, sliceTop - floor);
    if (sliceSize <= 0) break;
    required += sliceSize * bracket.rate;
    remaining -= sliceSize;
    floor = sliceTop;
    if (remaining <= 0) break;
  }
  return Math.round(required);
}

export interface SessionSettlementInput {
  /** The user's permanent balance immediately before this session began. */
  startingPermanent: number;
  /** The flat top-up granted for this session (SESSION_TOPUP in practice). */
  topUp: number;
  /** The player's chip stack at the moment they leave the session. */
  endingAmount: number;
  /** Total amount the player has wagered (bet/boot/show costs) this session. */
  wagered: number;
}

export interface SessionSettlement {
  startingPermanent: number;
  bankroll: number;
  endingAmount: number;
  wagered: number;
  requiredWager: number;
  thresholdMet: boolean;
  /** The permanent balance to persist once the session ends. */
  newPermanentBalance: number;
  /** newPermanentBalance - startingPermanent. */
  delta: number;
  /** Profit that was on the table but forfeited for not meeting the threshold. */
  profitForfeited: number;
}

/**
 * Resolve a Teen Patti session's outcome into a new permanent balance.
 *
 * - Ending >= starting bankroll (a profit, or exactly break-even): the
 *   profit converts to the permanent balance ONLY if cumulative wagered has
 *   reached `requiredWagerAmount(bankroll)`. Otherwise the entire profit is
 *   forfeited and the permanent balance simply reverts to what it was before
 *   the session started.
 * - Ending below the bankroll but still >= the starting permanent balance:
 *   the top-up absorbed the loss; the permanent balance is unchanged.
 * - Ending below the starting permanent balance: the permanent balance
 *   becomes exactly the ending amount.
 *
 * The wagering threshold only ever gates converting a PROFIT — it never
 * blocks leaving, and it never affects how a loss is applied.
 */
export function settleTeenPattiSession(input: SessionSettlementInput): SessionSettlement {
  const { startingPermanent, topUp, endingAmount, wagered } = input;
  const bankroll = startingPermanent + topUp;
  const requiredWager = requiredWagerAmount(bankroll);
  const safeWagered = Math.max(0, wagered);

  if (endingAmount >= bankroll) {
    const profit = endingAmount - bankroll;
    const thresholdMet = safeWagered >= requiredWager;
    const newPermanentBalance = thresholdMet ? startingPermanent + profit : startingPermanent;
    return {
      startingPermanent,
      bankroll,
      endingAmount,
      wagered: safeWagered,
      requiredWager,
      thresholdMet,
      newPermanentBalance,
      delta: newPermanentBalance - startingPermanent,
      profitForfeited: thresholdMet ? 0 : profit,
    };
  }

  if (endingAmount >= startingPermanent) {
    return {
      startingPermanent,
      bankroll,
      endingAmount,
      wagered: safeWagered,
      requiredWager,
      thresholdMet: true,
      newPermanentBalance: startingPermanent,
      delta: 0,
      profitForfeited: 0,
    };
  }

  return {
    startingPermanent,
    bankroll,
    endingAmount,
    wagered: safeWagered,
    requiredWager,
    thresholdMet: true,
    newPermanentBalance: endingAmount,
    delta: endingAmount - startingPermanent,
    profitForfeited: 0,
  };
}

/**
 * Callbreak payout: the final cumulative score in its DECIMAL display form
 * (e.g. 12.5, not the raw stored integer 125) drives the payout — positive
 * scores pay 100x, negative scores cost 50x (the downside is deliberately
 * gentler than the upside). `totalTenths` is the raw stored value (tenths of
 * a point), matching `CallbreakFinalStanding.totalTenths`.
 */
export function callbreakPayoutDelta(totalTenths: number): number {
  const decimal = totalTenths / 10;
  return Math.round(decimal >= 0 ? decimal * 100 : decimal * 50);
}

/** "31": flat payout to the last player standing, nothing for anyone else. */
export function thirtyOnePayoutDelta(isWinner: boolean): number {
  return isWinner ? 1000 : 0;
}

/**
 * Crazy 8s: fixed payout tiers by final rank (1st/2nd/3rd), paid once at game
 * end. Tiers are fixed positions, not fixed to headcount — if a bot occupies
 * a rank, whichever real player(s) hold the other ranks are still paid their
 * own tier; nobody is paid for a bot-held rank. Callers should only invoke
 * this for real (non-bot) players, passing that player's own final rank.
 */
export function crazy8PayoutDelta(rank: number): number {
  if (rank === 1) return 1000;
  if (rank === 2) return 500;
  if (rank === 3) return 250;
  return 0;
}
