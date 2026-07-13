import { describe, expect, it } from 'vitest';
import {
  callbreakPayoutDelta,
  crazy8PayoutDelta,
  requiredWagerAmount,
  SESSION_TOPUP,
  settleTeenPattiSession,
  STARTING_BALANCE,
  thirtyOnePayoutDelta,
} from './index';

describe('requiredWagerAmount — marginal brackets on total session bankroll', () => {
  it('zero or negative bankroll requires nothing', () => {
    expect(requiredWagerAmount(0)).toBe(0);
    expect(requiredWagerAmount(-500)).toBe(0);
  });

  it('entirely within the first bracket: flat 80%', () => {
    expect(requiredWagerAmount(50_000)).toBe(40_000);
  });

  it('exactly at the bracket boundary: still flat 80% (no second-bracket slice)', () => {
    expect(requiredWagerAmount(100_000)).toBe(80_000);
  });

  it('spans both brackets: 80% of the first 100k plus 35% of the remainder', () => {
    expect(requiredWagerAmount(150_000)).toBe(80_000 + 0.35 * 50_000);
  });

  it('a large bankroll still only pays 35% marginal on everything above 100k', () => {
    // Default session bankroll for a brand-new user: 100k permanent + 100k top-up.
    expect(requiredWagerAmount(STARTING_BALANCE + SESSION_TOPUP)).toBe(80_000 + 0.35 * 100_000);
    expect(requiredWagerAmount(1_100_000)).toBe(80_000 + 0.35 * 1_000_000);
  });
});

describe('settleTeenPattiSession', () => {
  const bankroll = STARTING_BALANCE + SESSION_TOPUP; // 200,000
  const required = requiredWagerAmount(bankroll); // 115,000

  it('profit, threshold met: permanent balance increases by exactly the profit', () => {
    const result = settleTeenPattiSession({
      startingPermanent: STARTING_BALANCE,
      topUp: SESSION_TOPUP,
      endingAmount: 250_000,
      wagered: required, // exactly meets it
    });
    expect(result.thresholdMet).toBe(true);
    expect(result.newPermanentBalance).toBe(STARTING_BALANCE + 50_000);
    expect(result.delta).toBe(50_000);
    expect(result.profitForfeited).toBe(0);
  });

  it('profit, threshold NOT met: profit is entirely forfeited, balance reverts to pre-session', () => {
    const result = settleTeenPattiSession({
      startingPermanent: STARTING_BALANCE,
      topUp: SESSION_TOPUP,
      endingAmount: 250_000,
      wagered: required - 1,
    });
    expect(result.thresholdMet).toBe(false);
    expect(result.newPermanentBalance).toBe(STARTING_BALANCE);
    expect(result.delta).toBe(0);
    expect(result.profitForfeited).toBe(50_000);
  });

  it('exact break-even (ending === bankroll): unchanged regardless of wagering', () => {
    const met = settleTeenPattiSession({
      startingPermanent: STARTING_BALANCE,
      topUp: SESSION_TOPUP,
      endingAmount: bankroll,
      wagered: required,
    });
    const notMet = settleTeenPattiSession({
      startingPermanent: STARTING_BALANCE,
      topUp: SESSION_TOPUP,
      endingAmount: bankroll,
      wagered: 0,
    });
    expect(met.newPermanentBalance).toBe(STARTING_BALANCE);
    expect(notMet.newPermanentBalance).toBe(STARTING_BALANCE);
  });

  it('loss fully absorbed by the top-up (ending below bankroll but >= starting permanent): unchanged, no threshold check', () => {
    const result = settleTeenPattiSession({
      startingPermanent: STARTING_BALANCE,
      topUp: SESSION_TOPUP,
      endingAmount: 120_000,
      wagered: 0, // never wagered enough for any threshold — must not matter for a loss
    });
    expect(result.newPermanentBalance).toBe(STARTING_BALANCE);
    expect(result.delta).toBe(0);
  });

  it('boundary: ending exactly equal to starting permanent counts as "absorbed", not "below"', () => {
    const result = settleTeenPattiSession({
      startingPermanent: STARTING_BALANCE,
      topUp: SESSION_TOPUP,
      endingAmount: STARTING_BALANCE,
      wagered: 0,
    });
    expect(result.newPermanentBalance).toBe(STARTING_BALANCE);
  });

  it('loss beyond the top-up (ending below starting permanent): new permanent balance is exactly the ending amount', () => {
    const result = settleTeenPattiSession({
      startingPermanent: STARTING_BALANCE,
      topUp: SESSION_TOPUP,
      endingAmount: 40_000,
      wagered: 0,
    });
    expect(result.newPermanentBalance).toBe(40_000);
    expect(result.delta).toBe(40_000 - STARTING_BALANCE);
  });

  it('a brand-new user (0 permanent balance) who busts out: unchanged at 0, never negative', () => {
    const result = settleTeenPattiSession({
      startingPermanent: 0,
      topUp: SESSION_TOPUP,
      endingAmount: 0,
      wagered: 0,
    });
    expect(result.newPermanentBalance).toBe(0);
  });

  it('a brand-new user who profits and meets the threshold on just the top-up bankroll', () => {
    const newUserBankroll = 0 + SESSION_TOPUP;
    const newUserRequired = requiredWagerAmount(newUserBankroll);
    const result = settleTeenPattiSession({
      startingPermanent: 0,
      topUp: SESSION_TOPUP,
      endingAmount: 150_000,
      wagered: newUserRequired,
    });
    expect(result.newPermanentBalance).toBe(50_000);
  });

  it('never blocks leaving or gates a loss: negative/garbage wagered input is clamped, not trusted', () => {
    const result = settleTeenPattiSession({
      startingPermanent: STARTING_BALANCE,
      topUp: SESSION_TOPUP,
      endingAmount: 40_000, // a loss branch — must be unaffected by wagered at all
      wagered: -999,
    });
    expect(result.newPermanentBalance).toBe(40_000);
  });
});

describe('callbreakPayoutDelta — decimal display form, gentler downside', () => {
  it('positive score pays 100x the decimal score', () => {
    expect(callbreakPayoutDelta(125)).toBe(1250); // "12.5"
  });

  it('negative score costs only 50x the decimal score', () => {
    expect(callbreakPayoutDelta(-125)).toBe(-625); // "-12.5"
  });

  it('a zero score is a zero payout', () => {
    expect(callbreakPayoutDelta(0)).toBe(0);
  });

  it('handles sub-1-point decimal scores correctly', () => {
    expect(callbreakPayoutDelta(5)).toBe(50); // "0.5" * 100
    expect(callbreakPayoutDelta(-5)).toBe(-25); // "-0.5" * 50
  });
});

describe('thirtyOnePayoutDelta — flat winner-take payout', () => {
  it('the winner gets a flat 1000', () => {
    expect(thirtyOnePayoutDelta(true)).toBe(1000);
  });

  it('everyone else gets nothing', () => {
    expect(thirtyOnePayoutDelta(false)).toBe(0);
  });
});

describe('crazy8PayoutDelta — fixed tiers by rank position', () => {
  it('pays the fixed tiers for 1st/2nd/3rd', () => {
    expect(crazy8PayoutDelta(1)).toBe(1000);
    expect(crazy8PayoutDelta(2)).toBe(500);
    expect(crazy8PayoutDelta(3)).toBe(250);
  });

  it('4th place (or lower) gets nothing', () => {
    expect(crazy8PayoutDelta(4)).toBe(0);
    expect(crazy8PayoutDelta(5)).toBe(0);
  });
});
