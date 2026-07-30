/**
 * Sportsbook Tax & Compensation Bonus — pure calculation layer.
 *
 * This module is an ADDITIVE backend layer on top of the existing sportsbook
 * engine. It never touches odds, tickets, wallets or settlement directly — it
 * only computes numbers that the placement and settlement code apply.
 *
 * Config is stored in the generic `settings` table under key `sportsbook.tax`
 * and read live on every request, so admin changes apply immediately without a
 * backend restart. All amounts are money-rounded to 2 decimals.
 *
 * Calculation order (per spec):
 *   1. Customer enters stake            (original_stake)
 *   2. Apply mandatory betting tax      (bet_tax_amount)
 *   3. Effective stake                  (effective_stake = stake - tax)
 *   4. Gross payout using effective     (gross = effective_stake * odds)
 *   5. Compensation bonus if enabled    (bonus = gross * bonus%)
 *   6. Winning tax if applicable        (on subtotal, above threshold)
 *   7. Final payout credited to wallet
 *
 * The customer-facing stake and odds are NEVER altered — only the internal
 * effective stake used for payout maths.
 */

import type { PoolClient } from 'pg';

export interface SportsbookTaxConfig {
  /** Mandatory betting tax on the stake. Default ENABLED. */
  betting_tax_enabled: boolean;
  /** Percent 0..100 (e.g. 15 = 15%). */
  betting_tax_percent: number;

  /** Optional compensation bonus on gross winnings. Default DISABLED. */
  compensation_bonus_enabled: boolean;
  compensation_bonus_percent: number;

  /** Winning tax on the (gross + bonus) subtotal. Default ENABLED. */
  winning_tax_enabled: boolean;
  winning_tax_percent: number;
  /** Only tax payouts strictly greater than this threshold. */
  winning_tax_threshold: number;
}

export const DEFAULT_SPORTSBOOK_TAX: SportsbookTaxConfig = {
  betting_tax_enabled: true,
  betting_tax_percent: 15,
  compensation_bonus_enabled: false,
  compensation_bonus_percent: 0,
  winning_tax_enabled: true,
  winning_tax_percent: 15,
  winning_tax_threshold: 1000,
};

const SETTINGS_KEY = 'sportsbook.tax';

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

function boolOf(v: unknown, fallback: boolean): boolean {
  if (v === null || v === undefined) return fallback;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') {
    if (v === 'true' || v === '1') return true;
    if (v === 'false' || v === '0') return false;
  }
  if (typeof v === 'number') return v !== 0;
  return fallback;
}

/** Accepts "15" (percent) or 15; clamps to a sane 0..100 range. */
function pctOf(v: unknown, fallback: number): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(100, n);
}

function numOf(v: unknown, fallback: number): number {
  if (v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function normalizeSportsbookTaxConfig(raw: unknown): SportsbookTaxConfig {
  const c =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    betting_tax_enabled: boolOf(
      c.betting_tax_enabled,
      DEFAULT_SPORTSBOOK_TAX.betting_tax_enabled
    ),
    betting_tax_percent: pctOf(
      c.betting_tax_percent,
      DEFAULT_SPORTSBOOK_TAX.betting_tax_percent
    ),
    compensation_bonus_enabled: boolOf(
      c.compensation_bonus_enabled,
      DEFAULT_SPORTSBOOK_TAX.compensation_bonus_enabled
    ),
    compensation_bonus_percent: pctOf(
      c.compensation_bonus_percent,
      DEFAULT_SPORTSBOOK_TAX.compensation_bonus_percent
    ),
    winning_tax_enabled: boolOf(
      c.winning_tax_enabled,
      DEFAULT_SPORTSBOOK_TAX.winning_tax_enabled
    ),
    winning_tax_percent: pctOf(
      c.winning_tax_percent,
      DEFAULT_SPORTSBOOK_TAX.winning_tax_percent
    ),
    winning_tax_threshold: numOf(
      c.winning_tax_threshold,
      DEFAULT_SPORTSBOOK_TAX.winning_tax_threshold
    ),
  };
}

/**
 * Load the live tax/bonus config for a tenant. Reads `settings.sportsbook.tax`;
 * when absent it falls back to the platform defaults AND, for the winning-tax
 * portion, honours any legacy `main.config` values so behaviour is preserved
 * for operators who only ever configured winning tax there.
 */
export async function loadSportsbookTaxConfig(
  client: PoolClient,
  tenantId: string
): Promise<SportsbookTaxConfig> {
  const r = await client.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
    [tenantId, SETTINGS_KEY]
  );
  if (r.rows[0]?.value) {
    return normalizeSportsbookTaxConfig(r.rows[0].value);
  }

  // Backward-compat: seed winning-tax defaults from the legacy betting-rules
  // row (main.config) if present, so the winning tax keeps its old values.
  const legacy = await client.query<{ value: Record<string, unknown> }>(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'main.config' LIMIT 1`,
    [tenantId]
  );
  const m = legacy.rows[0]?.value ?? {};
  const cfg = { ...DEFAULT_SPORTSBOOK_TAX };
  if (m.winning_tax_rate != null || m.tax_on_winnings_pct != null) {
    cfg.winning_tax_percent = pctOf(
      // legacy stored either 0.15 (fraction) or 15 (percent)
      (() => {
        const raw = Number(m.winning_tax_rate ?? m.tax_on_winnings_pct);
        return Number.isFinite(raw) ? (raw <= 1 ? raw * 100 : raw) : NaN;
      })(),
      DEFAULT_SPORTSBOOK_TAX.winning_tax_percent
    );
  }
  if (m.winning_tax_threshold != null) {
    cfg.winning_tax_threshold = numOf(
      m.winning_tax_threshold,
      DEFAULT_SPORTSBOOK_TAX.winning_tax_threshold
    );
  }
  return cfg;
}

/* -------------------------------------------------------------------------- */
/* Stake-side (placement)                                                     */
/* -------------------------------------------------------------------------- */

export interface StakeTaxSnapshot {
  original_stake: number;
  bet_tax_enabled: boolean;
  bet_tax_percent: number;
  bet_tax_amount: number;
  /** Stake the sportsbook engine must use for payout maths. */
  effective_stake: number;
}

/** Step 1-3: mandatory betting tax → effective stake. */
export function computeEffectiveStake(
  originalStake: number,
  cfg: SportsbookTaxConfig
): StakeTaxSnapshot {
  const stake = round2(originalStake);
  if (!cfg.betting_tax_enabled || cfg.betting_tax_percent <= 0) {
    return {
      original_stake: stake,
      bet_tax_enabled: false,
      bet_tax_percent: cfg.betting_tax_percent,
      bet_tax_amount: 0,
      effective_stake: stake,
    };
  }
  const betTaxAmount = round2(stake * (cfg.betting_tax_percent / 100));
  return {
    original_stake: stake,
    bet_tax_enabled: true,
    bet_tax_percent: cfg.betting_tax_percent,
    bet_tax_amount: betTaxAmount,
    effective_stake: round2(stake - betTaxAmount),
  };
}

/* -------------------------------------------------------------------------- */
/* Payout-side (settlement)                                                   */
/* -------------------------------------------------------------------------- */

export interface PayoutBreakdown {
  gross_payout_before_bonus: number;
  compensation_bonus_enabled: boolean;
  compensation_bonus_percent: number;
  compensation_bonus_amount: number;
  subtotal: number;
  winning_tax_enabled: boolean;
  winning_tax_percent: number;
  winning_tax_amount: number;
  final_payout: number;
}

/**
 * Steps 5-7 applied to a gross payout (gross = effective_stake × odds).
 * `cfg` is the snapshot captured at placement so a mid-life config change
 * never retroactively alters an open ticket.
 */
export function computeWinBreakdownFromGross(
  gross: number,
  cfg: SportsbookTaxConfig
): PayoutBreakdown {
  const grossRounded = round2(gross);

  const bonusEnabled =
    cfg.compensation_bonus_enabled && cfg.compensation_bonus_percent > 0;
  const bonusAmount = bonusEnabled
    ? round2(grossRounded * (cfg.compensation_bonus_percent / 100))
    : 0;

  const subtotal = round2(grossRounded + bonusAmount);

  const winTaxEnabled =
    cfg.winning_tax_enabled &&
    cfg.winning_tax_percent > 0 &&
    subtotal > cfg.winning_tax_threshold;
  const winTaxAmount = winTaxEnabled
    ? round2(subtotal * (cfg.winning_tax_percent / 100))
    : 0;

  return {
    gross_payout_before_bonus: grossRounded,
    compensation_bonus_enabled: bonusEnabled,
    compensation_bonus_percent: cfg.compensation_bonus_percent,
    compensation_bonus_amount: bonusAmount,
    subtotal,
    winning_tax_enabled: winTaxEnabled,
    winning_tax_percent: cfg.winning_tax_percent,
    winning_tax_amount: winTaxAmount,
    final_payout: round2(subtotal - winTaxAmount),
  };
}

/** Convenience: gross = effective_stake × odds, then the full breakdown. */
export function computeWinBreakdown(
  effectiveStake: number,
  effectiveOdds: number,
  cfg: SportsbookTaxConfig
): PayoutBreakdown {
  return computeWinBreakdownFromGross(effectiveStake * effectiveOdds, cfg);
}

/**
 * Rebuild the tax/bonus config from the snapshot stored on a ticket's
 * metadata (`metadata.tax_snapshot`). Returns null for legacy tickets that
 * were placed before this feature — callers must then preserve their prior
 * (pre-feature) settlement behaviour for those tickets.
 */
export function snapshotToConfig(
  metadata: unknown
): SportsbookTaxConfig | null {
  const snap =
    metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>).tax_snapshot
      : null;
  if (!snap || typeof snap !== 'object') return null;
  const s = snap as Record<string, unknown>;
  return {
    betting_tax_enabled: Boolean(s.betting_tax_enabled),
    betting_tax_percent: Number(s.betting_tax_percent) || 0,
    compensation_bonus_enabled: Boolean(s.compensation_bonus_enabled),
    compensation_bonus_percent: Number(s.compensation_bonus_percent) || 0,
    winning_tax_enabled: Boolean(s.winning_tax_enabled),
    winning_tax_percent: Number(s.winning_tax_percent) || 0,
    winning_tax_threshold: Number(s.winning_tax_threshold) || 0,
  };
}

/** A no-op breakdown: credit the full gross (legacy behaviour). */
export function passthroughBreakdown(gross: number): PayoutBreakdown {
  const g = round2(gross);
  return {
    gross_payout_before_bonus: g,
    compensation_bonus_enabled: false,
    compensation_bonus_percent: 0,
    compensation_bonus_amount: 0,
    subtotal: g,
    winning_tax_enabled: false,
    winning_tax_percent: 0,
    winning_tax_amount: 0,
    final_payout: g,
  };
}
