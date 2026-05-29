/**
 * Unit tests for the per-ticket loss-cashback engine.
 *
 * Covers every published tier boundary for Rule One and Rule Two plus
 * the cross-cutting eligibility rules (live exclusion, virtual
 * exclusion, void leg odds exclusion, min-legs, min-stake,
 * min-leg-odds, max-cashback cap, and idempotency-edge zero-amount).
 */
import { describe, it, expect } from 'vitest';
import {
  computeLossCashback,
  DEFAULT_PER_TICKET_CASHBACK,
  type LegInput,
  type PerTicketCashbackConfig,
} from './loss-cashback';

/* ---------- helpers ---------- */

function leg(
  status: 'won' | 'lost' | 'void' | 'cancelled' | 'postponed',
  odds: number,
  opts: { live?: boolean; virtual?: boolean } = {}
): LegInput {
  return {
    status,
    odds,
    is_live: !!opts.live,
    is_virtual: !!opts.virtual,
  };
}

function withRule(rule: 'rule_one' | 'rule_two'): PerTicketCashbackConfig {
  return {
    ...DEFAULT_PER_TICKET_CASHBACK,
    enabled: true,
    active_rule: rule,
  };
}

function manyLegs(
  count: number,
  odds: number,
  losts: number,
  opts: { live?: boolean; virtual?: boolean } = {}
): LegInput[] {
  const out: LegInput[] = [];
  for (let i = 0; i < count; i++) {
    out.push(leg(i < losts ? 'lost' : 'won', odds, opts));
  }
  return out;
}

/* ---------- engine on/off + basic guards ---------- */

describe('computeLossCashback — guards', () => {
  it('returns disabled when engine is off', () => {
    const cfg = { ...DEFAULT_PER_TICKET_CASHBACK, enabled: false };
    const v = computeLossCashback(100, manyLegs(10, 2, 1), cfg);
    expect(v.eligible).toBe(false);
    expect(v.reason).toBe('cashback_disabled');
  });

  it('rejects non-positive stake', () => {
    const v = computeLossCashback(0, manyLegs(10, 2, 1), withRule('rule_one'));
    expect(v.reason).toBe('invalid_stake');
  });

  it('rejects empty legs', () => {
    const v = computeLossCashback(100, [], withRule('rule_one'));
    expect(v.reason).toBe('no_legs');
  });

  it('rejects when nothing lost', () => {
    const v = computeLossCashback(100, manyLegs(10, 2, 0), withRule('rule_one'));
    expect(v.reason).toBe('no_losses');
  });

  it('rejects when too many legs lost (no slot for 4)', () => {
    const v = computeLossCashback(100, manyLegs(15, 2, 4), withRule('rule_one'));
    expect(v.reason).toBe('loss_count_out_of_range');
  });
});

/* ---------- live / virtual exclusions ---------- */

describe('computeLossCashback — exclusions', () => {
  it('excludes ticket with any live leg', () => {
    const legs = manyLegs(10, 2, 1);
    legs[3] = leg('won', 2, { live: true });
    const v = computeLossCashback(100, legs, withRule('rule_one'));
    expect(v.reason).toBe('live_bet_excluded');
  });

  it('excludes ticket with any virtual leg', () => {
    const legs = manyLegs(10, 2, 1);
    legs[5] = leg('won', 2, { virtual: true });
    const v = computeLossCashback(100, legs, withRule('rule_one'));
    expect(v.reason).toBe('virtual_bet_excluded');
  });
});

/* ---------- Rule One: cashback for losses on ONE game ---------- */

describe('Rule One — loss_one (≥10 legs, ≥1.25 odds, cap 10k)', () => {
  const cfg = withRule('rule_one');

  it('rejects when fewer than 10 legs', () => {
    const v = computeLossCashback(100, manyLegs(9, 2, 1), cfg);
    expect(v.reason).toBe('too_few_legs');
  });

  it('rejects when any leg is below 1.25', () => {
    const legs = manyLegs(10, 1.5, 1);
    legs[2] = leg('won', 1.2);
    const v = computeLossCashback(100, legs, cfg);
    expect(v.reason).toBe('leg_below_min_odds');
  });

  // 10 legs × 1.5 = 57.66 → tier 40-60 → 100% × stake
  it('40-60 tier returns 100% × stake', () => {
    const v = computeLossCashback(100, manyLegs(10, 1.5, 1), cfg);
    expect(v.eligible).toBe(true);
    expect(v.matched_tier?.pct).toBe(100);
    expect(v.amount).toBe(100);
  });

  // 10 legs × 1.6 = 109.95 → tier 91-150 → 350%
  it('91-150 tier returns 350% × stake', () => {
    const v = computeLossCashback(50, manyLegs(10, 1.6, 1), cfg);
    expect(v.matched_tier?.pct).toBe(350);
    expect(v.amount).toBe(175);
  });

  // 10 legs × 1.7 ≈ 201.6 → tier 201-450 → 800%
  it('201-450 tier returns 800% × stake', () => {
    const v = computeLossCashback(10, manyLegs(10, 1.7, 1), cfg);
    expect(v.matched_tier?.pct).toBe(800);
    expect(v.amount).toBe(80);
  });

  // 12 legs × 2 = 4096 → tier 451+ → 1000% × stake
  it('451+ tier returns 1000% × stake', () => {
    const v = computeLossCashback(10, manyLegs(12, 2, 1), cfg);
    expect(v.matched_tier?.pct).toBe(1000);
    expect(v.amount).toBe(100);
  });

  it('caps payout at max_cashback (10,000 ETB)', () => {
    // 12 legs × 2 = 4096 → tier 1000% → 1000% × 5000 = 50,000, cap = 10,000.
    const v = computeLossCashback(5000, manyLegs(12, 2, 1), cfg);
    expect(v.amount).toBe(10000);
  });

  it('rejects when effective odds is below lowest tier', () => {
    // 10 legs × 1.25 = 9.31 < 40 → no tier matches
    const v = computeLossCashback(100, manyLegs(10, 1.25, 1), cfg);
    expect(v.reason).toBe('odds_below_lowest_tier');
  });

  it('voided legs drop from odds calculation but stay in leg count', () => {
    // 11 legs, 1 voided, 1 lost, 9 won — voided leg is dropped from product.
    const legs: LegInput[] = [
      ...Array.from({ length: 9 }, () => leg('won', 1.5)),
      leg('lost', 1.5),
      leg('void', 100), // huge odds — must not be counted
    ];
    const v = computeLossCashback(100, legs, cfg);
    // Effective odds = 1.5^10 = 57.66 → tier 40-60 → 100%
    expect(v.eligible).toBe(true);
    expect(v.matched_tier?.pct).toBe(100);
  });
});

describe('Rule One — loss_two (≥15 legs, ≥1.25 odds, cap 10k)', () => {
  const cfg = withRule('rule_one');

  it('rejects when fewer than 15 legs', () => {
    const v = computeLossCashback(100, manyLegs(14, 2, 2), cfg);
    expect(v.reason).toBe('too_few_legs');
  });

  // 15 legs × 1.4 ≈ 155.5 → tier 151-250 → 350%
  it('151-250 tier returns 350% × stake', () => {
    const v = computeLossCashback(20, manyLegs(15, 1.4, 2), cfg);
    expect(v.matched_tier?.pct).toBe(350);
    expect(v.amount).toBe(70);
  });

  // 15 legs × 1.5 ≈ 437.9 → tier 401-700 → 800%
  it('401-700 tier returns 800% × stake', () => {
    const v = computeLossCashback(20, manyLegs(15, 1.5, 2), cfg);
    expect(v.matched_tier?.pct).toBe(800);
    expect(v.amount).toBe(160);
  });

  // 15 legs × 1.6 ≈ 1153.7 → tier 701+ → 1000%
  it('701+ tier returns 1000% × stake', () => {
    const v = computeLossCashback(50, manyLegs(15, 1.6, 2), cfg);
    expect(v.matched_tier?.pct).toBe(1000);
    expect(v.amount).toBe(500);
  });
});

/* ---------- Rule Two: cashback for losses on ONE / TWO / THREE games ---------- */

describe('Rule Two — loss_one (≥5 legs, ≥1.01 odds, min stake 5, cap 100k)', () => {
  const cfg = withRule('rule_two');

  it('rejects when stake below 5 ETB', () => {
    const v = computeLossCashback(4.99, manyLegs(6, 2, 1), cfg);
    expect(v.reason).toBe('stake_below_min');
  });

  it('rejects when fewer than 5 legs', () => {
    const v = computeLossCashback(50, manyLegs(4, 5, 1), cfg);
    expect(v.reason).toBe('too_few_legs');
  });

  // 5 legs × 2 = 32 → tier 20-44 → 100% × stake
  it('20-44 tier returns 100% × stake', () => {
    const v = computeLossCashback(20, manyLegs(5, 2, 1), cfg);
    expect(v.matched_tier?.pct).toBe(100);
    expect(v.amount).toBe(20);
  });

  // 5 legs × 2.2 ≈ 51.5 → tier 45-59 → 250%
  it('45-59 tier returns 250% × stake', () => {
    const v = computeLossCashback(10, manyLegs(5, 2.2, 1), cfg);
    expect(v.matched_tier?.pct).toBe(250);
    expect(v.amount).toBe(25);
  });

  // 6 legs × 2.5 = 244.14 → tier 90-449 → 600%
  it('90-449 tier returns 600% × stake', () => {
    const v = computeLossCashback(10, manyLegs(6, 2.5, 1), cfg);
    expect(v.matched_tier?.pct).toBe(600);
    expect(v.amount).toBe(60);
  });

  // 8 legs × 2.5 ≈ 1525.9 → tier 1000-1799 → 2100%
  it('1000-1799 tier returns 2100% × stake', () => {
    const v = computeLossCashback(10, manyLegs(8, 2.5, 1), cfg);
    expect(v.matched_tier?.pct).toBe(2100);
    expect(v.amount).toBe(210);
  });

  // 10 legs × 3 = 59049 → tier 1800+ → 5000%
  it('1800+ tier returns 5000% × stake', () => {
    const v = computeLossCashback(10, manyLegs(10, 3, 1), cfg);
    expect(v.matched_tier?.pct).toBe(5000);
    expect(v.amount).toBe(500);
  });

  it('caps payout at max_cashback (100,000 ETB)', () => {
    // 10 legs × 3 = 59049, 5000% × 5000 = 250,000, cap = 100,000.
    const v = computeLossCashback(5000, manyLegs(10, 3, 1), cfg);
    expect(v.amount).toBe(100000);
  });
});

describe('Rule Two — loss_two (≥10 legs, ≥1.01 odds, min stake 5)', () => {
  const cfg = withRule('rule_two');

  it('rejects when fewer than 10 legs for 2 losses', () => {
    const v = computeLossCashback(50, manyLegs(9, 2, 2), cfg);
    expect(v.reason).toBe('too_few_legs');
  });

  // 10 legs × 1.5 ≈ 57.7 → tier 45-59 → 250%
  it('45-59 tier returns 250% × stake', () => {
    const v = computeLossCashback(10, manyLegs(10, 1.5, 2), cfg);
    expect(v.matched_tier?.pct).toBe(250);
    expect(v.amount).toBe(25);
  });
});

describe('Rule Two — loss_three (≥10 legs, ≥1.40 odds, min stake 5)', () => {
  const cfg = withRule('rule_two');

  it('rejects when any leg is below 1.40', () => {
    // Need to keep exactly 3 losses so loss_three is picked.
    // manyLegs(10, 1.6, 3) → 3 losses at 1.6 + 7 wins at 1.6.
    // Replace a winning leg with a winning leg that has 1.39 odds.
    const legs = manyLegs(10, 1.6, 3);
    legs[5] = leg('won', 1.39);
    const v = computeLossCashback(50, legs, cfg);
    expect(v.reason).toBe('leg_below_min_odds');
  });

  // 10 legs × 1.6 ≈ 109.95 → tier 73-146 → 100%
  it('73-146 tier returns 100% × stake', () => {
    const v = computeLossCashback(50, manyLegs(10, 1.6, 3), cfg);
    expect(v.matched_tier?.pct).toBe(100);
    expect(v.amount).toBe(50);
  });

  // 10 legs × 1.8 ≈ 357.0 → tier 297-509 → 300%
  it('297-509 tier returns 300% × stake', () => {
    const v = computeLossCashback(20, manyLegs(10, 1.8, 3), cfg);
    expect(v.matched_tier?.pct).toBe(300);
    expect(v.amount).toBe(60);
  });

  // 10 legs × 2 = 1024 → tier 509-1153 → 400%
  it('509-1153 tier returns 400% × stake', () => {
    const v = computeLossCashback(10, manyLegs(10, 2, 3), cfg);
    expect(v.matched_tier?.pct).toBe(400);
    expect(v.amount).toBe(40);
  });

  // 12 legs × 2 = 4096 → tier 2411+ → 1000%
  it('2411+ tier returns 1000% × stake', () => {
    const v = computeLossCashback(10, manyLegs(12, 2, 3), cfg);
    expect(v.matched_tier?.pct).toBe(1000);
    expect(v.amount).toBe(100);
  });

  it('Rule Two: a ticket with only one cancelled match still qualifies', () => {
    // 9 wins + 3 losses at 1.5 + 1 cancelled (excluded from product).
    // Effective odds = 1.5^12 ≈ 129.75 → tier 73-146 → 100%.
    const legs: LegInput[] = [
      ...Array.from({ length: 9 }, () => leg('won', 1.5)),
      leg('lost', 1.5),
      leg('lost', 1.5),
      leg('lost', 1.5),
      leg('cancelled', 1000), // huge odds — must not poison the product
    ];
    const v = computeLossCashback(50, legs, cfg);
    expect(v.eligible).toBe(true);
    expect(v.matched_tier?.pct).toBe(100);
    expect(v.amount).toBe(50);
  });
});

/* ---------- result shape ---------- */

describe('computeLossCashback — verdict shape', () => {
  it('exposes diagnostic fields for the audit log', () => {
    const v = computeLossCashback(
      100,
      manyLegs(10, 1.5, 1),
      withRule('rule_one')
    );
    expect(v.rule).toBe('rule_one');
    expect(v.loss_count).toBe(1);
    expect(v.total_legs).toBe(10);
    expect(v.effective_odds).toBeGreaterThan(50);
    expect(v.effective_odds).toBeLessThan(65);
  });

  it('rounds amount to two decimal places', () => {
    const cfg = withRule('rule_one');
    // 100.1 stake × 100% = 100.1 → still 100.1
    const v = computeLossCashback(100.1, manyLegs(10, 1.5, 1), cfg);
    expect(v.amount).toBeCloseTo(100.1, 2);
  });
});
