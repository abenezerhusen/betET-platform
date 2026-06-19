/**
 * Per-ticket "Cashback for Losses" engine — Section 25.
 *
 * When a sportsbook accumulator bet settles as LOST, this module
 * evaluates the configured cashback rule (Rule One or Rule Two)
 * against the ticket's legs and credits the user when eligible.
 *
 * Two rule sets exist; the admin picks one as `active_rule`:
 *
 *   Rule One — narrow, high-bar accumulator insurance:
 *     loss_one  → min 10 legs, every leg odds ≥ 1.25, cap 10,000 ETB
 *                 tier table 40-60→100% … 451+→1000%
 *     loss_two  → min 15 legs, every leg odds ≥ 1.25, cap 10,000 ETB
 *                 tier table 65-90→100% … 701+→1000%
 *
 *   Rule Two — looser, deeper bonus ladder:
 *     loss_one   → min 5 legs, leg odds > 1.01, min stake 5, cap 100k
 *                  tier 20-44→100% … 1800+→5000%
 *     loss_two   → min 10 legs, leg odds > 1.01, min stake 5, cap 100k
 *                  (same tier table as loss_one)
 *     loss_three → min 10 legs, leg odds > 1.40, min stake 5, cap 100k
 *                  tier 73-146→100% … 2411+→1000%
 *
 * Exclusions (both rules):
 *   - cancelled / void / postponed legs are dropped from the odds
 *     calculation but still contribute to the leg-count requirement
 *     (Rule Two also: "a ticket with only one cancelled or postponed
 *     match is still eligible for cashback");
 *   - tickets with any Live or Virtual leg are ineligible.
 *
 * The compute function is pure; the apply function does the wallet
 * write, ledger entry and realtime notification. All wallet work runs
 * inside its own transaction so a failure here never reverses the
 * already-committed bet settlement.
 */
import type { PoolClient } from 'pg';
import { logger } from '../../infrastructure/logger';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { emitToUser, emitWalletUpdated, Events } from '../../realtime/socket';

/* -------------------------------------------------------------------------- */
/* Configuration shape                                                        */
/* -------------------------------------------------------------------------- */

export interface CashbackTier {
  /** Lower bound (inclusive). */
  min_odds: number;
  /** Upper bound (inclusive). `null` ⇒ open-ended (e.g. "451 and above"). */
  max_odds: number | null;
  /** Stake multiplier expressed as a percentage (100 = 1x stake). */
  pct: number;
}

export interface LossSlot {
  enabled: boolean;
  /** Min legs the slip must carry to qualify. */
  min_legs: number;
  /** Each non-void leg must clear this odds floor (`>` for Rule Two,
   *  `≥` here for both — spec drift is sub-cent and the admin can edit). */
  min_leg_odds: number;
  /** Optional minimum stake (Rule Two requires 5 ETB). */
  min_stake: number;
  /** Hard cap on the cashback amount (ETB). */
  max_cashback: number;
  tiers: CashbackTier[];
}

export interface RuleConfig {
  loss_one: LossSlot;
  loss_two: LossSlot;
  /** Only Rule Two enables a 3-loss cashback. */
  loss_three?: LossSlot;
}

export interface PerTicketCashbackConfig {
  enabled: boolean;
  active_rule: 'rule_one' | 'rule_two';
  payout_as: 'bonus' | 'cash';
  exclude_live: boolean;
  exclude_virtual: boolean;
  rule_one: RuleConfig;
  rule_two: RuleConfig;
}

export interface LegInput {
  /** 'won' | 'lost' | 'void' | 'cancelled' | 'pending' */
  status: string;
  odds: number;
  /** True when the bet was placed AFTER the linked match kicked off. */
  is_live: boolean;
  /** True for virtual / simulated sports. */
  is_virtual: boolean;
}

/* -------------------------------------------------------------------------- */
/* Default values populated from the Section 25 spec                          */
/* -------------------------------------------------------------------------- */

const RULE_ONE_LOSS_ONE_TIERS: CashbackTier[] = [
  { min_odds: 40, max_odds: 60, pct: 100 },
  { min_odds: 61, max_odds: 90, pct: 200 },
  { min_odds: 91, max_odds: 150, pct: 350 },
  { min_odds: 151, max_odds: 200, pct: 600 },
  { min_odds: 201, max_odds: 450, pct: 800 },
  { min_odds: 451, max_odds: null, pct: 1000 },
];

const RULE_ONE_LOSS_TWO_TIERS: CashbackTier[] = [
  { min_odds: 65, max_odds: 90, pct: 100 },
  { min_odds: 91, max_odds: 150, pct: 200 },
  { min_odds: 151, max_odds: 250, pct: 350 },
  { min_odds: 251, max_odds: 400, pct: 600 },
  { min_odds: 401, max_odds: 700, pct: 800 },
  { min_odds: 701, max_odds: null, pct: 1000 },
];

const RULE_TWO_LOSS_TIERS: CashbackTier[] = [
  { min_odds: 20, max_odds: 44, pct: 100 },
  { min_odds: 45, max_odds: 59, pct: 250 },
  { min_odds: 60, max_odds: 89, pct: 350 },
  { min_odds: 90, max_odds: 449, pct: 600 },
  { min_odds: 450, max_odds: 999, pct: 1200 },
  { min_odds: 1000, max_odds: 1799, pct: 2100 },
  { min_odds: 1800, max_odds: null, pct: 5000 },
];

const RULE_TWO_LOSS_THREE_TIERS: CashbackTier[] = [
  { min_odds: 73, max_odds: 146, pct: 100 },
  { min_odds: 146, max_odds: 297, pct: 200 },
  { min_odds: 297, max_odds: 509, pct: 300 },
  { min_odds: 509, max_odds: 1153, pct: 400 },
  { min_odds: 1153, max_odds: 2411, pct: 500 },
  { min_odds: 2411, max_odds: null, pct: 1000 },
];

export const DEFAULT_PER_TICKET_CASHBACK: PerTicketCashbackConfig = {
  enabled: true,
  active_rule: 'rule_one',
  payout_as: 'bonus',
  exclude_live: true,
  exclude_virtual: true,
  rule_one: {
    loss_one: {
      enabled: true,
      min_legs: 10,
      min_leg_odds: 1.25,
      min_stake: 0,
      max_cashback: 10000,
      tiers: RULE_ONE_LOSS_ONE_TIERS,
    },
    loss_two: {
      enabled: true,
      min_legs: 15,
      min_leg_odds: 1.25,
      min_stake: 0,
      max_cashback: 10000,
      tiers: RULE_ONE_LOSS_TWO_TIERS,
    },
  },
  rule_two: {
    loss_one: {
      enabled: true,
      min_legs: 5,
      min_leg_odds: 1.01,
      min_stake: 5,
      max_cashback: 100000,
      tiers: RULE_TWO_LOSS_TIERS,
    },
    loss_two: {
      enabled: true,
      min_legs: 10,
      min_leg_odds: 1.01,
      min_stake: 5,
      max_cashback: 100000,
      tiers: RULE_TWO_LOSS_TIERS,
    },
    loss_three: {
      enabled: true,
      min_legs: 10,
      min_leg_odds: 1.4,
      min_stake: 5,
      max_cashback: 100000,
      tiers: RULE_TWO_LOSS_THREE_TIERS,
    },
  },
};

/* -------------------------------------------------------------------------- */
/* Pure compute                                                               */
/* -------------------------------------------------------------------------- */

export interface CashbackVerdict {
  eligible: boolean;
  /** Cashback amount in ETB (or whatever currency the bet was placed in). */
  amount: number;
  reason: string;
  /** Diagnostic fields surfaced for the cashier panel / audit log. */
  rule: 'rule_one' | 'rule_two';
  loss_count: number;
  matched_tier?: CashbackTier;
  effective_odds?: number;
  total_legs?: number;
}

function pickSlot(rule: RuleConfig, lossCount: number): LossSlot | null {
  if (lossCount === 1) return rule.loss_one;
  if (lossCount === 2) return rule.loss_two;
  if (lossCount === 3) return rule.loss_three ?? null;
  return null;
}

function pickTier(
  tiers: CashbackTier[],
  effectiveOdds: number
): CashbackTier | null {
  for (const t of tiers) {
    const lower = effectiveOdds >= t.min_odds;
    const upper = t.max_odds === null ? true : effectiveOdds <= t.max_odds;
    if (lower && upper) return t;
  }
  return null;
}

const VOID_STATUSES = new Set(['void', 'cancelled', 'postponed']);

export function computeLossCashback(
  stake: number,
  legs: LegInput[],
  config: PerTicketCashbackConfig
): CashbackVerdict {
  const baseVerdict = (
    reason: string,
    extra?: Partial<CashbackVerdict>
  ): CashbackVerdict => ({
    eligible: false,
    amount: 0,
    reason,
    rule: config.active_rule,
    loss_count: legs.filter((l) => l.status === 'lost').length,
    total_legs: legs.length,
    ...extra,
  });

  if (!config.enabled) return baseVerdict('cashback_disabled');
  if (!Number.isFinite(stake) || stake <= 0) return baseVerdict('invalid_stake');
  if (legs.length === 0) return baseVerdict('no_legs');

  // Live / virtual exclusions
  if (config.exclude_live && legs.some((l) => l.is_live)) {
    return baseVerdict('live_bet_excluded');
  }
  if (config.exclude_virtual && legs.some((l) => l.is_virtual)) {
    return baseVerdict('virtual_bet_excluded');
  }

  const lossCount = legs.filter((l) => l.status === 'lost').length;
  if (lossCount === 0) {
    return baseVerdict('no_losses', { loss_count: 0 });
  }

  const ruleCfg =
    config.active_rule === 'rule_two' ? config.rule_two : config.rule_one;
  const slot = pickSlot(ruleCfg, lossCount);
  if (!slot) return baseVerdict('loss_count_out_of_range', { loss_count: lossCount });
  if (!slot.enabled) return baseVerdict('slot_disabled', { loss_count: lossCount });

  if (slot.min_stake > 0 && stake < slot.min_stake) {
    return baseVerdict('stake_below_min', { loss_count: lossCount });
  }
  if (legs.length < slot.min_legs) {
    return baseVerdict('too_few_legs', { loss_count: lossCount });
  }

  // Per-leg minimum odds — applies to every selected leg (won, lost,
  // even voided ones since the user did select them).
  const minLegOdds = slot.min_leg_odds ?? 0;
  if (minLegOdds > 0 && legs.some((l) => l.odds < minLegOdds)) {
    return baseVerdict('leg_below_min_odds', { loss_count: lossCount });
  }

  // Effective accumulator odds excluding voided / cancelled legs.
  const effectiveLegs = legs.filter((l) => !VOID_STATUSES.has(l.status));
  if (effectiveLegs.length === 0) {
    return baseVerdict('all_legs_void', { loss_count: lossCount });
  }
  const effectiveOdds = effectiveLegs.reduce((acc, l) => acc * l.odds, 1);

  const tier = pickTier(slot.tiers, effectiveOdds);
  if (!tier) {
    return baseVerdict('odds_below_lowest_tier', {
      loss_count: lossCount,
      effective_odds: effectiveOdds,
    });
  }

  const raw = (tier.pct / 100) * stake;
  const amount = Math.round(Math.min(raw, slot.max_cashback) * 100) / 100;
  if (amount <= 0) {
    return baseVerdict('amount_zero', {
      loss_count: lossCount,
      effective_odds: effectiveOdds,
      matched_tier: tier,
    });
  }

  return {
    eligible: true,
    amount,
    reason: 'qualified',
    rule: config.active_rule,
    loss_count: lossCount,
    matched_tier: tier,
    effective_odds: effectiveOdds,
    total_legs: legs.length,
  };
}

/* -------------------------------------------------------------------------- */
/* Settings loader                                                            */
/* -------------------------------------------------------------------------- */

async function loadCashbackConfig(
  client: PoolClient,
  tenantId: string
): Promise<PerTicketCashbackConfig> {
  const versioned = await client.query<{ value: Record<string, unknown> | null }>(
    `SELECT value FROM settings
      WHERE tenant_id = $1 AND key = 'promotions.cashback_rules'`,
    [tenantId]
  );
  const ruleStore = versioned.rows[0]?.value as
    | {
        active_rule_id?: string | null;
        rules?: Array<{
          id?: string;
          is_active?: boolean;
          status?: string;
          config?: { per_ticket?: PerTicketCashbackConfig };
        }>;
      }
    | null;
  if (ruleStore?.rules?.length) {
    const active =
      ruleStore.rules.find((r) => r.id === ruleStore.active_rule_id) ??
      ruleStore.rules.find((r) => r.is_active === true) ??
      null;
    if (active?.status === 'active' && active.config?.per_ticket) {
      const cfg = active.config.per_ticket;
      return { ...cfg, enabled: true };
    }
  }

  const r = await client.query<{ value: Record<string, unknown> | null }>(
    `SELECT value FROM settings
      WHERE tenant_id = $1 AND key = 'promotions.bonus_settings'`,
    [tenantId]
  );
  const v = r.rows[0]?.value as
    | { cashback?: { per_ticket?: PerTicketCashbackConfig } }
    | null;
  const fallback = v?.cashback?.per_ticket ?? DEFAULT_PER_TICKET_CASHBACK;
  return { ...fallback, enabled: true };
}

/* -------------------------------------------------------------------------- */
/* Settlement-time hook                                                       */
/* -------------------------------------------------------------------------- */

export interface ApplyLossCashbackParams {
  tenantId: string;
  betId: string;
  userId: string;
  stake: number;
  currency: string;
  walletId: string | null;
  /** Pre-loaded legs; if omitted we query sportsbook_bet_legs ourselves. */
  legs?: LegInput[];
}

/**
 * Fetch each leg's status, odds and live/virtual classification for
 * the given sportsbook bet. The live classification compares the bet
 * placement time to the linked event's `starts_at`.
 */
async function fetchLegsForBet(
  client: PoolClient,
  tenantId: string,
  betId: string
): Promise<LegInput[]> {
  const r = await client.query<{
    status: string;
    odds: string;
    starts_at: Date | null;
    placed_at: Date;
    sport: string | null;
  }>(
    `SELECT l.status,
            l.odds_at_placement::text AS odds,
            e.starts_at,
            b.placed_at,
            e.sport
       FROM sportsbook_bet_legs l
       JOIN sports_selections s ON s.id = l.selection_id
       JOIN sports_markets m   ON m.id = s.market_id
       JOIN sports_events  e   ON e.id = m.event_id
       JOIN sportsbook_bets b  ON b.id = l.bet_id
      WHERE l.tenant_id = $1 AND l.bet_id = $2`,
    [tenantId, betId]
  );
  return r.rows.map((row) => {
    const odds = Number(row.odds ?? 0);
    const isLive =
      row.starts_at !== null &&
      row.placed_at.getTime() >= new Date(row.starts_at).getTime();
    const isVirtual = (row.sport ?? '').toLowerCase().includes('virtual');
    return {
      status: row.status,
      odds: Number.isFinite(odds) ? odds : 0,
      is_live: isLive,
      is_virtual: isVirtual,
    };
  });
}

/**
 * Evaluate and (if eligible) credit cashback for a settled losing
 * sportsbook bet. Best-effort: a failure here never blocks settlement.
 *
 * Returns the verdict so the caller can audit it (or fold it into the
 * settlements summary).
 */
export async function applyLossCashback(
  params: ApplyLossCashbackParams
): Promise<CashbackVerdict | null> {
  try {
    return await withTenantClient(
      { tenantId: params.tenantId, bypassRls: true },
      async (client) => {
        const config = await loadCashbackConfig(client, params.tenantId);
        const legs =
          params.legs ??
          (await fetchLegsForBet(client, params.tenantId, params.betId));
        const verdict = computeLossCashback(params.stake, legs, config);
        if (!verdict.eligible || verdict.amount <= 0) return verdict;

        // Resolve the wallet to credit.
        let walletId = params.walletId;
        let currency = params.currency;
        if (!walletId) {
          const w = await client.query<{
            id: string;
            currency: string;
          }>(
            `SELECT id, currency FROM wallets
              WHERE tenant_id = $1 AND user_id = $2
              ORDER BY created_at ASC LIMIT 1`,
            [params.tenantId, params.userId]
          );
          if (!w.rows[0]) return verdict; // user has no wallet — abort silently
          walletId = w.rows[0].id;
          currency = w.rows[0].currency;
        }

        // Idempotency: refuse double-credits for the same bet+rule.
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM transactions
            WHERE tenant_id = $1
              AND user_id = $2
              AND type = 'bonus_credit'
              AND metadata->>'kind' = 'loss_cashback'
              AND metadata->>'bet_id' = $3
            LIMIT 1`,
          [params.tenantId, params.userId, params.betId]
        );
        if (existing.rows[0]) return verdict;

        const wallet = await client.query<{
          id: string;
          balance: string;
          bonus_balance: string;
          currency: string;
        }>(
          `SELECT id, balance::text, bonus_balance::text, currency
             FROM wallets WHERE id = $1 FOR UPDATE`,
          [walletId]
        );
        const w = wallet.rows[0];
        if (!w) return verdict;

        const beforeBalance = Number(w.balance);
        const beforeBonus = Number(w.bonus_balance);
        let afterBalance = beforeBalance;
        let afterBonus = beforeBonus;
        if (config.payout_as === 'cash') {
          afterBalance = Math.round((beforeBalance + verdict.amount) * 100) / 100;
          await client.query(
            `UPDATE wallets SET balance = $1, updated_at = now() WHERE id = $2`,
            [afterBalance, w.id]
          );
        } else {
          afterBonus = Math.round((beforeBonus + verdict.amount) * 100) / 100;
          await client.query(
            `UPDATE wallets SET bonus_balance = $1, updated_at = now() WHERE id = $2`,
            [afterBonus, w.id]
          );
        }

        await client.query(
          `INSERT INTO transactions
             (tenant_id, wallet_id, user_id, type, amount,
              before_balance, after_balance, currency, status, reference, metadata)
           VALUES ($1, $2, $3, 'bonus_credit', $4::numeric,
                   $5::numeric, $6::numeric, $7, 'completed', $8, $9::jsonb)`,
          [
            params.tenantId,
            w.id,
            params.userId,
            verdict.amount,
            beforeBalance,
            config.payout_as === 'cash' ? afterBalance : beforeBalance,
            currency ?? w.currency,
            `loss_cashback:${params.betId}`,
            JSON.stringify({
              kind: 'loss_cashback',
              bet_id: params.betId,
              rule: verdict.rule,
              loss_count: verdict.loss_count,
              tier_pct: verdict.matched_tier?.pct,
              effective_odds: verdict.effective_odds,
              payout_as: config.payout_as,
            }),
          ]
        );

        emitWalletUpdated(params.tenantId, params.userId, {
          reason: 'loss_cashback_awarded',
          wallet: {
            id: w.id,
            currency: currency ?? w.currency,
            balance: afterBalance,
            bonus_balance: afterBonus,
          },
          bet_id: params.betId,
          amount: verdict.amount,
        });
        emitToUser(params.tenantId, params.userId, Events.BONUS_CLAIMED, {
          type: 'loss_cashback',
          bet_id: params.betId,
          rule: verdict.rule,
          loss_count: verdict.loss_count,
          amount: verdict.amount,
          payout_as: config.payout_as,
        });

        return verdict;
      }
    );
  } catch (err) {
    logger.error(
      { err, tenantId: params.tenantId, betId: params.betId },
      'loss cashback evaluation failed'
    );
    return null;
  }
}
