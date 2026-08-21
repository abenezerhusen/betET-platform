/**
 * Unit tests for the First Deposit (Welcome) bonus amount calculator.
 *
 * These cover the pure, admin-configurable maths only (no DB): match
 * percentage, the max-bonus cap, the max-eligible-deposit cap, the
 * "uncapped" (0) sentinels and rounding. Eligibility gating, per-user
 * limits, budgets and settlement turnover are exercised at runtime with
 * live config and are intentionally out of scope for this unit test.
 */
import { describe, it, expect } from 'vitest';
import {
  computeFirstDepositBonus,
  DEFAULT_FIRST_DEPOSIT_BONUS,
  firstDepositBonusSchema,
  type FirstDepositBonusConfig,
} from './first-deposit';

function cfg(overrides: Partial<FirstDepositBonusConfig> = {}): FirstDepositBonusConfig {
  return firstDepositBonusSchema.parse({ ...DEFAULT_FIRST_DEPOSIT_BONUS, ...overrides });
}

describe('computeFirstDepositBonus — defaults (100% up to 500, max eligible 500)', () => {
  it('matches 100% of a deposit within the eligible band', () => {
    const v = computeFirstDepositBonus(cfg(), 100);
    expect(v.eligibleDeposit).toBe(100);
    expect(v.bonus).toBe(100);
  });

  it('caps the bonus at max_bonus', () => {
    // 800 deposit → eligible capped at 500 → 100% = 500, and max_bonus = 500.
    const v = computeFirstDepositBonus(cfg(), 800);
    expect(v.eligibleDeposit).toBe(500);
    expect(v.bonus).toBe(500);
  });

  it('caps eligible deposit at max_eligible_deposit', () => {
    const v = computeFirstDepositBonus(cfg({ max_bonus: 0 }), 1200);
    expect(v.eligibleDeposit).toBe(500);
    expect(v.bonus).toBe(500);
  });
});

describe('computeFirstDepositBonus — match percentage', () => {
  it('applies a 50% match', () => {
    const v = computeFirstDepositBonus(cfg({ match_pct: 50, max_bonus: 0 }), 200);
    expect(v.bonus).toBe(100);
  });

  it('applies a 200% match (super-match)', () => {
    const v = computeFirstDepositBonus(
      cfg({ match_pct: 200, max_bonus: 0, max_eligible_deposit: 0 }),
      100
    );
    expect(v.bonus).toBe(200);
  });

  it('returns zero bonus when match_pct is 0', () => {
    const v = computeFirstDepositBonus(cfg({ match_pct: 0 }), 500);
    expect(v.bonus).toBe(0);
  });
});

describe('computeFirstDepositBonus — uncapped sentinels (0)', () => {
  it('max_bonus = 0 means uncapped bonus', () => {
    const v = computeFirstDepositBonus(
      cfg({ max_bonus: 0, max_eligible_deposit: 0, match_pct: 100 }),
      5000
    );
    expect(v.eligibleDeposit).toBe(5000);
    expect(v.bonus).toBe(5000);
  });

  it('max_eligible_deposit = 0 means the whole deposit is eligible', () => {
    const v = computeFirstDepositBonus(
      cfg({ max_eligible_deposit: 0, max_bonus: 0, match_pct: 100 }),
      750
    );
    expect(v.eligibleDeposit).toBe(750);
    expect(v.bonus).toBe(750);
  });
});

describe('computeFirstDepositBonus — rounding', () => {
  it('rounds the bonus to two decimals', () => {
    // 33.33% of 100 = 33.33
    const v = computeFirstDepositBonus(
      cfg({ match_pct: 33.33, max_bonus: 0, max_eligible_deposit: 0 }),
      100
    );
    expect(v.bonus).toBeCloseTo(33.33, 2);
  });

  it('handles fractional deposits within the eligible band', () => {
    const v = computeFirstDepositBonus(
      cfg({ match_pct: 100, max_bonus: 0, max_eligible_deposit: 0 }),
      10.55
    );
    expect(v.bonus).toBeCloseTo(10.55, 2);
  });
});

describe('firstDepositBonusSchema — defaults', () => {
  it('parses an empty object into the documented defaults', () => {
    const d = firstDepositBonusSchema.parse({});
    expect(d.is_enabled).toBe(false);
    expect(d.match_pct).toBe(100);
    expect(d.max_bonus).toBe(500);
    expect(d.min_deposit).toBe(10);
    expect(d.max_eligible_deposit).toBe(500);
    expect(d.wagering_multiplier).toBe(5);
    expect(d.qualifying_bet_type).toBe('accumulator');
    expect(d.min_selections).toBe(3);
    expect(d.min_selection_odds).toBe(1.4);
    expect(d.expires_in_days).toBe(7);
    expect(d.max_claims_per_user).toBe(1);
  });

  it('coerces numeric strings from the admin form', () => {
    const d = firstDepositBonusSchema.parse({
      match_pct: '150',
      max_bonus: '1000',
      min_deposit: '20',
    });
    expect(d.match_pct).toBe(150);
    expect(d.max_bonus).toBe(1000);
    expect(d.min_deposit).toBe(20);
  });
});
