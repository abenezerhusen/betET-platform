/**
 * Section 18 — single source of truth for the runtime betting rules.
 *
 * The admin panel writes betting rules across THREE settings rows:
 *
 *   main.config     -- typed (Zod) block with the long-standing fields:
 *                      min_bet_stake, max_bet_stake, max_accumulator_legs,
 *                      max_total_odds, tax_on_winnings_pct,
 *                      winning_tax_threshold, cashout_enabled,
 *                      live_betting_enabled, max_payout_per_slip.
 *
 *   main.slip       -- free-form JSON block with the Section-18F slip
 *                      rules: max_pending_stake, max_pending_slips,
 *                      max_duplicate_slips, online_min_stake,
 *                      offline_min_stake, min_individual_odd,
 *                      sales_cancel_window, cashback_rule, …
 *
 *   main.cashout    -- free-form JSON block with the Section-18D cashout
 *                      rules: cashout.min_total_odd, cashout.min_stake,
 *                      cashout.min_individual_odd, cashout.min_matches,
 *                      cashout.win_criteria, cashout.win_criteria_value,
 *                      cashout.max_cashout_amount,
 *                      cashout.allow_bonus_cashout,
 *                      cashout.allow_abandoned_match.
 *
 * This module reads all three rows, applies defensive defaults that
 * match the spec example values, and produces a normalised
 * `BettingConfig` object the bet placement / settlement / cashout code
 * can rely on without re-checking JSONB shapes.
 */

import type { PoolClient } from 'pg';

export interface SlipRules {
  /** Max selections per slip. */
  max_legs: number;
  /** Max stake that can be locked in pending slips at once (per user). */
  max_pending_stake: number;
  /** Max identical slips a single user can have open at the same time. */
  max_duplicate_slips: number;
  /** Max active (unresolved) slips per user. */
  max_pending_slips: number;
  /** Minimum stake for an ONLINE bet. */
  online_min_stake: number;
  /** Minimum stake for an OFFLINE (cashier) bet. */
  offline_min_stake: number;
  /** Per-leg minimum decimal odds. */
  min_individual_odd: number;
  /** Max product-of-odds for the entire slip. */
  max_total_odds: number;
  /** Minutes after sale that a sales agent / cashier may cancel. */
  sales_cancel_window: number;
  /** Minutes after match start that the bet can still be cancelled. */
  bet_cancel_window_after_match: number;
  /** "percentage" | "fixed" — how cashback is computed. */
  cashback_rule: 'percentage' | 'fixed';
  /** Whether to surface bet ids in the user dashboard. */
  show_ticket_id_on_dashboard: boolean;
  /** Hard cap on payout per slip — defence-in-depth for very large odds. */
  max_payout_per_slip: number;
}

export interface TaxRules {
  /** Percentage as a 0..1 fraction (15% → 0.15). */
  winning_tax_rate: number;
  /** Only tax payouts strictly greater than this threshold. */
  winning_tax_threshold: number;
}

export interface CashoutRules {
  enabled: boolean;
  min_total_odd: number;
  min_stake: number;
  min_individual_odd: number;
  min_matches: number;
  win_criteria: 'percentage' | 'amount';
  win_criteria_value: number;
  max_cashout_amount: number;
  allow_bonus_cashout: boolean;
  allow_abandoned_match: boolean;
  /** Retention the platform takes on early cashout. 0.15 → user gets 85%. */
  retention_rate: number;
}

export interface BettingConfig {
  slip: SlipRules;
  tax: TaxRules;
  cashout: CashoutRules;
  /** Convenience: whether live in-play betting is allowed at all. */
  live_betting_enabled: boolean;
}

/* -------------------------------------------------------------------------- */
/* Spec defaults                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_SLIP: SlipRules = {
  max_legs: 20,
  max_pending_stake: 100_000,
  max_duplicate_slips: 5,
  max_pending_slips: 50,
  online_min_stake: 10,
  offline_min_stake: 10,
  min_individual_odd: 1.05,
  max_total_odds: 1000,
  sales_cancel_window: 5,
  bet_cancel_window_after_match: 0,
  cashback_rule: 'percentage',
  show_ticket_id_on_dashboard: true,
  max_payout_per_slip: 1_000_000,
};

const DEFAULT_TAX: TaxRules = {
  winning_tax_rate: 0.15,
  winning_tax_threshold: 1000,
};

const DEFAULT_CASHOUT: CashoutRules = {
  enabled: true,
  min_total_odd: 1.5,
  min_stake: 50,
  min_individual_odd: 1.2,
  min_matches: 2,
  win_criteria: 'percentage',
  win_criteria_value: 80,
  max_cashout_amount: 10_000,
  allow_bonus_cashout: false,
  allow_abandoned_match: true,
  retention_rate: 0.15,
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function numberOf(value: unknown, fallback: number): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function boolOf(value: unknown, fallback: boolean): boolean {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value === 'true' || value === '1') return true;
    if (value === 'false' || value === '0') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

function stringOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  return fallback;
}

function asPct(value: unknown, fallback: number): number {
  // Accept either "15" (percent) or "0.15" (fraction).
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n > 1) return n / 100;
  return n;
}

async function readJsonSetting(
  client: PoolClient,
  tenantId: string,
  key: string
): Promise<Record<string, unknown>> {
  const r = await client.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
    [tenantId, key]
  );
  const v = r.rows[0]?.value;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
}

/* -------------------------------------------------------------------------- */
/* Public                                                                     */
/* -------------------------------------------------------------------------- */

export async function loadBettingConfig(
  client: PoolClient,
  tenantId: string
): Promise<BettingConfig> {
  const [mainCfg, slipCfg, cashoutCfg] = await Promise.all([
    readJsonSetting(client, tenantId, 'main.config'),
    readJsonSetting(client, tenantId, 'main.slip'),
    readJsonSetting(client, tenantId, 'main.cashout'),
  ]);

  // The cashout block may live nested under "cashout" inside main.cashout,
  // OR live flat at the top level. Normalise.
  const cashoutFlat: Record<string, unknown> =
    (cashoutCfg.cashout as Record<string, unknown> | undefined) ?? cashoutCfg;

  const slip: SlipRules = {
    max_legs: numberOf(
      slipCfg.max_legs ?? mainCfg.max_accumulator_legs,
      DEFAULT_SLIP.max_legs
    ),
    max_pending_stake: numberOf(
      slipCfg.max_pending_stake,
      DEFAULT_SLIP.max_pending_stake
    ),
    max_duplicate_slips: numberOf(
      slipCfg.max_duplicate_slips,
      DEFAULT_SLIP.max_duplicate_slips
    ),
    max_pending_slips: numberOf(
      slipCfg.max_pending_slips,
      DEFAULT_SLIP.max_pending_slips
    ),
    online_min_stake: numberOf(
      slipCfg.online_min_stake ?? mainCfg.min_bet_stake,
      DEFAULT_SLIP.online_min_stake
    ),
    offline_min_stake: numberOf(
      slipCfg.offline_min_stake ?? mainCfg.min_bet_stake,
      DEFAULT_SLIP.offline_min_stake
    ),
    min_individual_odd: numberOf(
      slipCfg.min_individual_odd,
      DEFAULT_SLIP.min_individual_odd
    ),
    max_total_odds: numberOf(
      slipCfg.max_total_odds ?? mainCfg.max_total_odds,
      DEFAULT_SLIP.max_total_odds
    ),
    sales_cancel_window: numberOf(
      slipCfg.sales_cancel_window,
      DEFAULT_SLIP.sales_cancel_window
    ),
    bet_cancel_window_after_match: numberOf(
      slipCfg.bet_cancel_window_after_match,
      DEFAULT_SLIP.bet_cancel_window_after_match
    ),
    cashback_rule: stringOf(
      slipCfg.cashback_rule,
      ['percentage', 'fixed'] as const,
      DEFAULT_SLIP.cashback_rule
    ),
    show_ticket_id_on_dashboard: boolOf(
      slipCfg.show_ticket_id_on_dashboard,
      DEFAULT_SLIP.show_ticket_id_on_dashboard
    ),
    max_payout_per_slip: numberOf(
      slipCfg.max_payout_per_slip ?? mainCfg.max_payout_per_slip,
      DEFAULT_SLIP.max_payout_per_slip
    ),
  };

  const tax: TaxRules = {
    winning_tax_rate: asPct(
      mainCfg.winning_tax_rate ?? mainCfg.tax_on_winnings_pct,
      DEFAULT_TAX.winning_tax_rate
    ),
    winning_tax_threshold: numberOf(
      mainCfg.winning_tax_threshold,
      DEFAULT_TAX.winning_tax_threshold
    ),
  };

  const cashout: CashoutRules = {
    enabled: boolOf(
      mainCfg.cashout_enabled ?? cashoutFlat.enabled,
      DEFAULT_CASHOUT.enabled
    ),
    min_total_odd: numberOf(
      cashoutFlat.min_total_odd,
      DEFAULT_CASHOUT.min_total_odd
    ),
    min_stake: numberOf(cashoutFlat.min_stake, DEFAULT_CASHOUT.min_stake),
    min_individual_odd: numberOf(
      cashoutFlat.min_individual_odd,
      DEFAULT_CASHOUT.min_individual_odd
    ),
    min_matches: numberOf(cashoutFlat.min_matches, DEFAULT_CASHOUT.min_matches),
    win_criteria: stringOf(
      cashoutFlat.win_criteria,
      ['percentage', 'amount'] as const,
      DEFAULT_CASHOUT.win_criteria
    ),
    win_criteria_value: numberOf(
      cashoutFlat.win_criteria_value,
      DEFAULT_CASHOUT.win_criteria_value
    ),
    max_cashout_amount: numberOf(
      cashoutFlat.max_cashout_amount,
      DEFAULT_CASHOUT.max_cashout_amount
    ),
    allow_bonus_cashout: boolOf(
      cashoutFlat.allow_bonus_cashout,
      DEFAULT_CASHOUT.allow_bonus_cashout
    ),
    allow_abandoned_match: boolOf(
      cashoutFlat.allow_abandoned_match,
      DEFAULT_CASHOUT.allow_abandoned_match
    ),
    retention_rate: asPct(
      cashoutFlat.retention_rate,
      DEFAULT_CASHOUT.retention_rate
    ),
  };

  return {
    slip,
    tax,
    cashout,
    live_betting_enabled: boolOf(mainCfg.live_betting_enabled, true),
  };
}

/* -------------------------------------------------------------------------- */
/* Pure tax helper — used at settlement AND in cashout previews.              */
/* -------------------------------------------------------------------------- */

export function applyWinningTax(
  net_pay: number,
  tax: TaxRules
): { tax_amount: number; final_payout: number } {
  if (!Number.isFinite(net_pay) || net_pay <= 0) {
    return { tax_amount: 0, final_payout: 0 };
  }
  if (net_pay > tax.winning_tax_threshold) {
    const tax_amount = Math.round(net_pay * tax.winning_tax_rate * 100) / 100;
    return {
      tax_amount,
      final_payout: Math.round((net_pay - tax_amount) * 100) / 100,
    };
  }
  return { tax_amount: 0, final_payout: Math.round(net_pay * 100) / 100 };
}
