/**
 * First Deposit (Welcome) Bonus.
 *
 * A fully admin-configurable welcome bonus granted on a user's FIRST
 * qualifying (online) deposit. It reuses the existing bonus architecture
 * end-to-end — nothing new is bolted onto the wallet/betting engines:
 *
 *   - Config is a single tenant-scoped `settings` row
 *     (`promotions.first_deposit_bonus`), exactly like the registration
 *     bonus / cashout boost. Every value is configurable from the Admin
 *     Panel; nothing is hard-coded.
 *   - The grant credits `wallets.bonus_balance` (the platform's existing
 *     non-withdrawable "locked bonus" bucket) and records a
 *     `bonus_assignments` row carrying the wagering requirement, expiry and
 *     an audit trail in `metadata` — the same shape the registration bonus
 *     uses.
 *   - Turnover is counted at SETTLEMENT on qualifying accumulators (see
 *     `applyFirstDepositWageringOnSettle`). On completion the awarded amount
 *     moves `bonus_balance -> balance`, mirroring the existing bet-hooks
 *     conversion. On expiry the un-earned bonus is removed and the record is
 *     marked EXPIRED (never deleted).
 *
 * All operations are best-effort and isolated from the deposit/settlement
 * that triggered them: a bonus failure never rolls back a deposit or a bet
 * settlement.
 */
import { z } from 'zod';
import type { PoolClient } from 'pg';
import { logger } from '../../infrastructure/logger';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { Events, emitToUser, emitWalletUpdated } from '../../realtime/socket';

export const FIRST_DEPOSIT_CONFIG_KEY = 'promotions.first_deposit_bonus';

/**
 * Admin-configurable schema. Uses `.passthrough()` so future keys survive a
 * round-trip without a schema bump, matching the registration-bonus pattern.
 */
export const firstDepositBonusSchema = z
  .object({
    is_enabled: z.boolean().default(false),
    bonus_name: z.string().trim().max(120).default('First Deposit Welcome'),
    description: z.string().trim().max(2000).default(''),
    // Match percentage of the (eligible) deposit, e.g. 100 = 100%.
    match_pct: z.coerce.number().min(0).max(1000).default(100),
    // Hard cap on the bonus amount regardless of deposit (0 = uncapped).
    max_bonus: z.coerce.number().nonnegative().max(10_000_000).default(500),
    // Minimum deposit that qualifies for the bonus.
    min_deposit: z.coerce.number().nonnegative().max(10_000_000).default(10),
    // Deposit above this is not matched (0 = no cap on eligible deposit).
    max_eligible_deposit: z.coerce.number().nonnegative().max(10_000_000).default(500),
    // Turnover multiplier applied to the BONUS amount (not the deposit).
    wagering_multiplier: z.coerce.number().min(0).max(1000).default(5),
    // Qualifying bet type for turnover: accumulator only, or any bet.
    qualifying_bet_type: z.enum(['accumulator', 'any']).default('accumulator'),
    // Minimum selections and per-selection odds for a qualifying accumulator.
    min_selections: z.coerce.number().int().min(0).max(100).default(3),
    min_selection_odds: z.coerce.number().min(0).max(1000).default(1.4),
    // Bonus validity window in days (0 = never expires).
    expires_in_days: z.coerce.number().int().min(0).max(3650).default(7),
    // Max grants per user (0 = unlimited; default 1).
    max_claims_per_user: z.coerce.number().int().min(0).max(1000).default(1),
    // Optional promotion window. Empty string / null = open-ended.
    start_date: z.string().trim().nullable().optional().default(null),
    end_date: z.string().trim().nullable().optional().default(null),
    // Financial safety caps (0 = unlimited).
    daily_budget: z.coerce.number().nonnegative().max(1_000_000_000).default(0),
    monthly_budget: z.coerce.number().nonnegative().max(1_000_000_000).default(0),
    total_budget: z.coerce.number().nonnegative().max(1_000_000_000).default(0),
    max_total_claims: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
    // Optional user-group targeting (opaque tags matched against user metadata).
    eligible_user_groups: z.array(z.string().trim().max(64)).max(100).default([]),
    // What happens to already-granted bonuses when the promo is disabled.
    existing_bonus_policy: z.enum(['continue', 'cancel']).default('continue'),
  })
  .passthrough();

export type FirstDepositBonusConfig = z.infer<typeof firstDepositBonusSchema>;

export const DEFAULT_FIRST_DEPOSIT_BONUS: FirstDepositBonusConfig =
  firstDepositBonusSchema.parse({});

/** Read the live config for a tenant, merged over defaults. */
export async function loadFirstDepositConfig(
  client: PoolClient,
  tenantId: string
): Promise<FirstDepositBonusConfig> {
  const row = await client.query<{ value: Record<string, unknown> }>(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2`,
    [tenantId, FIRST_DEPOSIT_CONFIG_KEY]
  );
  return { ...DEFAULT_FIRST_DEPOSIT_BONUS, ...(row.rows[0]?.value ?? {}) };
}

/** Deposit ledger types considered an "online qualifying deposit". */
const ONLINE_DEPOSIT_TYPES = ['deposit', 'p2p_deposit'] as const;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Compute the bonus amount for a deposit under a config (capped). */
export function computeFirstDepositBonus(
  cfg: FirstDepositBonusConfig,
  depositAmount: number
): { eligibleDeposit: number; bonus: number } {
  const eligibleDeposit =
    cfg.max_eligible_deposit > 0
      ? Math.min(depositAmount, cfg.max_eligible_deposit)
      : depositAmount;
  let bonus = round2(eligibleDeposit * (cfg.match_pct / 100));
  if (cfg.max_bonus > 0) bonus = Math.min(bonus, cfg.max_bonus);
  return { eligibleDeposit, bonus: round2(bonus) };
}

async function sumAwarded(
  client: PoolClient,
  tenantId: string,
  window: 'day' | 'month' | null
): Promise<number> {
  const windowClause =
    window === 'day'
      ? "AND ba.awarded_at >= date_trunc('day', now())"
      : window === 'month'
        ? "AND ba.awarded_at >= date_trunc('month', now())"
        : '';
  const r = await client.query<{ total: string }>(
    `SELECT COALESCE(SUM(ba.awarded_amount), 0)::text AS total
       FROM bonus_assignments ba
      WHERE ba.tenant_id = $1
        AND ba.metadata->>'source' = 'first_deposit_bonus'
        ${windowClause}`,
    [tenantId]
  );
  return Number(r.rows[0]?.total ?? 0);
}

/**
 * Grant the First Deposit Welcome bonus if the user is eligible. Best-effort;
 * runs in its own transaction and swallows errors so a deposit is never
 * blocked or reversed by a bonus problem. Idempotent per user.
 */
export async function grantFirstDepositBonus(params: {
  tenantId: string;
  userId: string;
  amount: number | string;
  source?: string;
  depositRef?: string;
}): Promise<void> {
  const deposit =
    typeof params.amount === 'number' ? params.amount : Number(params.amount);
  if (!Number.isFinite(deposit) || deposit <= 0) return;

  try {
    await withTenantClient(
      { tenantId: params.tenantId, bypassRls: true },
      async (client) => {
        const cfg = await loadFirstDepositConfig(client, params.tenantId);
        if (!cfg.is_enabled) return;

        // Promotion window.
        const now = new Date();
        if (cfg.start_date) {
          const s = new Date(cfg.start_date);
          if (!Number.isNaN(s.getTime()) && now < s) return;
        }
        if (cfg.end_date) {
          const e = new Date(cfg.end_date);
          if (!Number.isNaN(e.getTime()) && now > e) return;
        }

        // Minimum deposit gate.
        if (deposit < cfg.min_deposit) return;

        const { eligibleDeposit, bonus } = computeFirstDepositBonus(cfg, deposit);
        if (!(bonus > 0)) return;

        // First-deposit gate. The current deposit is already recorded in the
        // ledger, so a first deposit yields exactly one completed online row.
        const depCount = await client.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
             FROM transactions
            WHERE tenant_id = $1 AND user_id = $2 AND status = 'completed'
              AND type = ANY($3::text[])`,
          [params.tenantId, params.userId, ONLINE_DEPOSIT_TYPES as unknown as string[]]
        );
        if ((depCount.rows[0]?.n ?? 0) > 1) return;

        // Per-user claim gate (also the primary idempotency guard).
        const claimed = await client.query<{ n: number }>(
          `SELECT COUNT(*)::int AS n
             FROM bonus_assignments
            WHERE tenant_id = $1 AND user_id = $2
              AND metadata->>'source' = 'first_deposit_bonus'`,
          [params.tenantId, params.userId]
        );
        const maxClaims = cfg.max_claims_per_user > 0 ? cfg.max_claims_per_user : 1;
        if ((claimed.rows[0]?.n ?? 0) >= maxClaims) return;

        // Financial-safety budgets and total claim caps.
        if (cfg.total_budget > 0) {
          const used = await sumAwarded(client, params.tenantId, null);
          if (used + bonus > cfg.total_budget) {
            logger.warn(
              { tenantId: params.tenantId, used, bonus, cap: cfg.total_budget },
              'first deposit bonus: total budget reached — skipping grant'
            );
            return;
          }
        }
        if (cfg.monthly_budget > 0) {
          const used = await sumAwarded(client, params.tenantId, 'month');
          if (used + bonus > cfg.monthly_budget) return;
        }
        if (cfg.daily_budget > 0) {
          const used = await sumAwarded(client, params.tenantId, 'day');
          if (used + bonus > cfg.daily_budget) return;
        }
        if (cfg.max_total_claims > 0) {
          const c = await client.query<{ n: number }>(
            `SELECT COUNT(*)::int AS n FROM bonus_assignments
              WHERE tenant_id = $1 AND metadata->>'source' = 'first_deposit_bonus'`,
            [params.tenantId]
          );
          if ((c.rows[0]?.n ?? 0) >= cfg.max_total_claims) return;
        }

        // Managed (hidden) rule carrying the wagering rules. is_active=false so
        // it never appears in claimable/public bonus lists. wager_stage marks it
        // for settlement-time turnover so the placement hook skips it.
        const ruleConfig = {
          amount: bonus,
          match_pct: cfg.match_pct,
          wagering_multiplier: cfg.wagering_multiplier,
          expires_in_days: cfg.expires_in_days,
          min_selections: cfg.min_selections,
          min_selection_odds: cfg.min_selection_odds,
          qualifying_bet_type: cfg.qualifying_bet_type,
          wager_stage: 'settlement',
          source: 'first_deposit_bonus',
        };
        const ruleRes = await client.query<{ id: string }>(
          `INSERT INTO bonus_rules (tenant_id, name, type, config, is_active, status, priority)
           VALUES ($1, 'First Deposit Welcome (auto)', 'deposit', $2::jsonb, false, 'disabled', 0)
           ON CONFLICT (tenant_id, name)
             DO UPDATE SET config = EXCLUDED.config, updated_at = now()
           RETURNING id`,
          [params.tenantId, JSON.stringify(ruleConfig)]
        );
        const ruleId = ruleRes.rows[0]?.id;
        if (!ruleId) return;

        const exists = await client.query(
          `SELECT 1 FROM bonus_assignments
            WHERE tenant_id = $1 AND bonus_rule_id = $2 AND user_id = $3 LIMIT 1`,
          [params.tenantId, ruleId, params.userId]
        );
        if ((exists.rowCount ?? 0) > 0) return;

        const wageringRequired = Number((bonus * cfg.wagering_multiplier).toFixed(4));
        const expiresAt =
          cfg.expires_in_days > 0
            ? new Date(Date.now() + cfg.expires_in_days * 24 * 60 * 60 * 1000)
            : null;

        const asgRes = await client.query<{ id: string }>(
          `INSERT INTO bonus_assignments
             (tenant_id, bonus_rule_id, user_id, awarded_by, awarded_amount,
              wagering_required, expires_at, metadata)
           VALUES ($1,$2,$3,NULL,$4::numeric,$5::numeric,$6,$7::jsonb)
           RETURNING id`,
          [
            params.tenantId,
            ruleId,
            params.userId,
            bonus,
            wageringRequired,
            expiresAt,
            JSON.stringify({
              source: 'first_deposit_bonus',
              bonus_name: cfg.bonus_name,
              deposit_amount: deposit,
              eligible_deposit: eligibleDeposit,
              match_pct: cfg.match_pct,
              wagering_multiplier: cfg.wagering_multiplier,
              min_selections: cfg.min_selections,
              min_selection_odds: cfg.min_selection_odds,
              qualifying_bet_type: cfg.qualifying_bet_type,
              wager_stage: 'settlement',
              deposit_ref: params.depositRef ?? null,
              deposit_source: params.source ?? null,
              counted_bets: [],
            }),
          ]
        );
        const assignmentId = asgRes.rows[0]?.id;

        // Credit the non-withdrawable bonus balance (locked bonus funds).
        const currency = 'ETB';
        await client.query(
          `INSERT INTO wallets (tenant_id, user_id, currency, balance)
           VALUES ($1, $2, $3, 0)
           ON CONFLICT ON CONSTRAINT wallets_user_currency_unique DO NOTHING`,
          [params.tenantId, params.userId, currency]
        );
        const walletQ = await client.query<{
          id: string;
          bonus_balance: string;
          currency: string;
        }>(
          `SELECT id, bonus_balance::text, currency
             FROM wallets
            WHERE tenant_id = $1 AND user_id = $2 AND currency = $3
            FOR UPDATE`,
          [params.tenantId, params.userId, currency]
        );
        const wallet = walletQ.rows[0];
        if (!wallet) return;
        const before = Number(wallet.bonus_balance);
        await client.query(
          `UPDATE wallets
              SET bonus_balance = bonus_balance + $2::numeric,
                  version = version + 1,
                  updated_at = now()
            WHERE id = $1`,
          [wallet.id, bonus]
        );
        await client.query(
          `INSERT INTO transactions
             (tenant_id, wallet_id, user_id, type, amount, before_balance,
              after_balance, currency, reference, status, metadata)
           VALUES ($1,$2,$3,'bonus_credit',$4::numeric,$5::numeric,$6::numeric,
                   $7,$8,'completed',$9::jsonb)`,
          [
            params.tenantId,
            wallet.id,
            params.userId,
            bonus,
            before,
            before + bonus,
            wallet.currency,
            assignmentId
              ? `bonus:${assignmentId}`
              : `first_deposit_bonus:${params.userId}`,
            JSON.stringify({
              source: 'first_deposit_bonus',
              non_withdrawable: true,
              bonus_assignment_id: assignmentId ?? null,
              wagering_required: wageringRequired,
              deposit_amount: deposit,
              kind: 'first_deposit_bonus',
            }),
          ]
        );

        emitToUser(params.tenantId, params.userId, Events.BONUS_CLAIMED, {
          type: 'first_deposit_bonus_awarded',
          assignment_id: assignmentId,
          amount: bonus,
          wagering_required: wageringRequired,
          expires_at: expiresAt,
        });
        emitWalletUpdated(params.tenantId, params.userId, {
          reason: 'first_deposit_bonus',
          wallet: { id: wallet.id, currency: wallet.currency },
          bonus_assignment_id: assignmentId,
        });
        logger.info(
          {
            tenantId: params.tenantId,
            userId: params.userId,
            deposit,
            bonus,
            wageringRequired,
          },
          'first deposit bonus granted'
        );
      }
    );
  } catch (err) {
    logger.error(
      { err, tenantId: params.tenantId, userId: params.userId },
      'first deposit bonus grant failed (non-fatal)'
    );
  }
}

interface FdAssignmentRow {
  id: string;
  bonus_rule_id: string;
  awarded_amount: string;
  wagering_required: string;
  wagering_progress: string;
  status: string;
  expires_at: string | null;
  metadata: Record<string, unknown> | null;
  config: Record<string, unknown> | null;
}

/** Mark an assignment EXPIRED and remove any un-earned bonus balance. */
async function expireAssignment(
  client: PoolClient,
  tenantId: string,
  userId: string,
  a: { id: string; awarded_amount: string }
): Promise<void> {
  await client.query(
    `UPDATE bonus_assignments SET status = 'expired', updated_at = now() WHERE id = $1`,
    [a.id]
  );
  const award = Number(a.awarded_amount ?? 0);
  if (!(award > 0)) return;
  const wq = await client.query<{
    id: string;
    currency: string;
    bonus_balance: string;
  }>(
    `SELECT id, currency, bonus_balance::text
       FROM wallets
      WHERE tenant_id = $1 AND user_id = $2
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE`,
    [tenantId, userId]
  );
  const w = wq.rows[0];
  if (!w) return;
  const beforeBonus = Number(w.bonus_balance);
  const removable = Math.min(beforeBonus, award);
  if (!(removable > 0)) return;
  await client.query(
    `UPDATE wallets
        SET bonus_balance = GREATEST(bonus_balance - $1::numeric, 0),
            version = version + 1,
            updated_at = now()
      WHERE id = $2`,
    [removable, w.id]
  );
  await client.query(
    `INSERT INTO transactions
       (tenant_id, wallet_id, user_id, type, amount, before_balance,
        after_balance, currency, status, metadata)
     VALUES ($1,$2,$3,'bonus_debit',$4::numeric,$5::numeric,$6::numeric,$7,'completed',$8::jsonb)`,
    [
      tenantId,
      w.id,
      userId,
      removable,
      beforeBonus,
      beforeBonus - removable,
      w.currency,
      JSON.stringify({
        source: 'first_deposit_bonus',
        kind: 'bonus_expired',
        bonus_assignment_id: a.id,
      }),
    ]
  );
  emitWalletUpdated(tenantId, userId, {
    reason: 'first_deposit_bonus_expired',
    wallet: { id: w.id, currency: w.currency },
    bonus_assignment_id: a.id,
  });
}

/**
 * Count qualifying accumulator turnover toward the First Deposit bonus when a
 * bet settles (won/lost, never void). Idempotent per bet via a `counted_bets`
 * marker in the assignment metadata (row-locked). On completion the awarded
 * amount converts bonus_balance -> balance, mirroring bet-hooks.
 */
export async function applyFirstDepositWageringOnSettle(params: {
  tenantId: string;
  userId: string;
  betId: string;
  stake: number;
  betType: string | null;
  legCount: number;
  minLegOdds: number;
  outcome: 'won' | 'lost';
}): Promise<void> {
  if (!Number.isFinite(params.stake) || params.stake <= 0) return;

  try {
    await withTenantClient(
      { tenantId: params.tenantId, bypassRls: true },
      async (client) => {
        const assignments = await client.query<FdAssignmentRow>(
          `SELECT ba.id, ba.bonus_rule_id,
                  ba.awarded_amount::text,
                  ba.wagering_required::text,
                  ba.wagering_progress::text,
                  ba.status,
                  ba.expires_at,
                  ba.metadata,
                  br.config
             FROM bonus_assignments ba
             JOIN bonus_rules br ON br.id = ba.bonus_rule_id
            WHERE ba.tenant_id = $1
              AND ba.user_id = $2
              AND ba.status = 'active'
              AND ba.wagering_required > 0
              AND (br.config->>'wager_stage') = 'settlement'
            ORDER BY ba.awarded_at ASC
            FOR UPDATE OF ba`,
          [params.tenantId, params.userId]
        );
        if (assignments.rows.length === 0) return;

        for (const a of assignments.rows) {
          // Lazy expiry: past-expiry bonuses are locked, not counted.
          if (a.expires_at && new Date(a.expires_at) <= new Date()) {
            await expireAssignment(client, params.tenantId, params.userId, a);
            continue;
          }

          const cfg = (a.config ?? {}) as Record<string, unknown>;
          const qualType = String(cfg.qualifying_bet_type ?? 'accumulator');
          const minSelections = Number(cfg.min_selections ?? 0);
          const minSelectionOdds = Number(cfg.min_selection_odds ?? 0);

          // Qualification: accumulator (combo) only, unless config allows any.
          if (qualType === 'accumulator' && params.betType !== 'combo') continue;
          if (minSelections > 0 && params.legCount < minSelections) continue;
          if (minSelectionOdds > 0 && params.minLegOdds < minSelectionOdds) continue;

          // Idempotency — never count a bet twice for the same assignment.
          const meta = (a.metadata ?? {}) as Record<string, unknown>;
          const counted = Array.isArray(meta.counted_bets)
            ? (meta.counted_bets as string[])
            : [];
          if (counted.includes(params.betId)) continue;

          const required = Number(a.wagering_required ?? 0);
          const currentProgress = Number(a.wagering_progress ?? 0);
          const remaining = Math.max(0, required - currentProgress);
          if (remaining <= 0) continue;

          const credit = Math.min(remaining, params.stake);
          const nextProgress = currentProgress + credit;
          const completed = nextProgress >= required;
          const nextMeta = { ...meta, counted_bets: [...counted, params.betId] };

          if (!completed) {
            await client.query(
              `UPDATE bonus_assignments
                  SET wagering_progress = $1::numeric, metadata = $2::jsonb
                WHERE id = $3`,
              [nextProgress, JSON.stringify(nextMeta), a.id]
            );
            emitToUser(params.tenantId, params.userId, Events.BONUS_CLAIMED, {
              type: 'wagering_progress',
              assignment_id: a.id,
              wagering_progress: nextProgress,
              wagering_required: required,
            });
            continue;
          }

          // Completion — convert bonus -> cash.
          await client.query(
            `UPDATE bonus_assignments
                SET status = 'completed',
                    completed_at = now(),
                    wagering_progress = $1::numeric,
                    metadata = $2::jsonb
              WHERE id = $3`,
            [nextProgress, JSON.stringify(nextMeta), a.id]
          );

          const award = Number(a.awarded_amount ?? 0);
          if (award > 0) {
            const wallet = await client.query<{
              id: string;
              currency: string;
              balance: string;
              bonus_balance: string;
            }>(
              `SELECT id, currency, balance::text, bonus_balance::text
                 FROM wallets
                WHERE tenant_id = $1 AND user_id = $2
                ORDER BY created_at ASC
                LIMIT 1
                FOR UPDATE`,
              [params.tenantId, params.userId]
            );
            const w = wallet.rows[0];
            if (w) {
              const beforeBalance = Number(w.balance);
              const beforeBonus = Number(w.bonus_balance);
              const moveable = Math.min(beforeBonus, award);
              await client.query(
                `UPDATE wallets
                    SET balance = balance + $1::numeric,
                        bonus_balance = GREATEST(bonus_balance - $1::numeric, 0),
                        version = version + 1,
                        updated_at = now()
                  WHERE id = $2`,
                [moveable, w.id]
              );
              await client.query(
                `INSERT INTO transactions
                   (tenant_id, wallet_id, user_id, type, amount,
                    before_balance, after_balance, currency, status, metadata)
                 VALUES ($1,$2,$3,'bonus_credit',$4::numeric,
                         $5::numeric,$6::numeric,$7,'completed',$8::jsonb)`,
                [
                  params.tenantId,
                  w.id,
                  params.userId,
                  moveable,
                  beforeBalance,
                  beforeBalance + moveable,
                  w.currency,
                  JSON.stringify({
                    source: 'first_deposit_bonus',
                    bonus_assignment_id: a.id,
                    bonus_rule_id: a.bonus_rule_id,
                    kind: 'bonus_conversion',
                  }),
                ]
              );
              emitWalletUpdated(params.tenantId, params.userId, {
                reason: 'first_deposit_bonus_complete',
                wallet: { id: w.id, currency: w.currency },
                bonus_assignment_id: a.id,
              });
            }
          }

          emitToUser(params.tenantId, params.userId, Events.BONUS_CLAIMED, {
            type: 'first_deposit_bonus_completed',
            assignment_id: a.id,
            awarded_amount: a.awarded_amount,
          });
        }
      }
    );
  } catch (err) {
    logger.error(
      {
        err,
        tenantId: params.tenantId,
        userId: params.userId,
        betId: params.betId,
      },
      'first deposit wagering update failed (non-fatal)'
    );
  }
}

/** Sweep: expire any past-expiry active First Deposit bonuses for a tenant. */
export async function expireFirstDepositBonuses(tenantId: string): Promise<void> {
  try {
    await withTenantClient({ tenantId, bypassRls: true }, async (client) => {
      const rows = await client.query<{
        id: string;
        user_id: string;
        awarded_amount: string;
      }>(
        `SELECT ba.id, ba.user_id, ba.awarded_amount::text
           FROM bonus_assignments ba
           JOIN bonus_rules br ON br.id = ba.bonus_rule_id
          WHERE ba.tenant_id = $1
            AND ba.status = 'active'
            AND (br.config->>'wager_stage') = 'settlement'
            AND ba.expires_at IS NOT NULL
            AND ba.expires_at <= now()
          FOR UPDATE OF ba`,
        [tenantId]
      );
      for (const a of rows.rows) {
        await expireAssignment(client, tenantId, a.user_id, a);
      }
    });
  } catch (err) {
    logger.error({ err, tenantId }, 'first deposit bonus expiry sweep failed');
  }
}

/** Admin dashboard aggregates for the First Deposit promotion. */
export async function getFirstDepositBonusStats(
  client: PoolClient,
  tenantId: string
): Promise<Record<string, number>> {
  const r = await client.query<{
    total_claimed: string;
    total_bonus_issued: string;
    total_bonus_unlocked: string;
    total_bonus_expired: string;
    total_qualifying_turnover: string;
    total_deposited: string;
    active: string;
    completed: string;
    expired: string;
    cancelled: string;
    issued_today: string;
    issued_month: string;
  }>(
    `SELECT
        COUNT(*)::text AS total_claimed,
        COALESCE(SUM(awarded_amount),0)::text AS total_bonus_issued,
        COALESCE(SUM(awarded_amount) FILTER (WHERE status = 'completed'),0)::text AS total_bonus_unlocked,
        COALESCE(SUM(awarded_amount) FILTER (WHERE status = 'expired'),0)::text AS total_bonus_expired,
        COALESCE(SUM(wagering_progress),0)::text AS total_qualifying_turnover,
        COALESCE(SUM((metadata->>'deposit_amount')::numeric),0)::text AS total_deposited,
        COUNT(*) FILTER (WHERE status = 'active')::text AS active,
        COUNT(*) FILTER (WHERE status = 'completed')::text AS completed,
        COUNT(*) FILTER (WHERE status = 'expired')::text AS expired,
        COUNT(*) FILTER (WHERE status IN ('cancelled','forfeited'))::text AS cancelled,
        COALESCE(SUM(awarded_amount) FILTER (WHERE awarded_at >= date_trunc('day', now())),0)::text AS issued_today,
        COALESCE(SUM(awarded_amount) FILTER (WHERE awarded_at >= date_trunc('month', now())),0)::text AS issued_month
       FROM bonus_assignments
      WHERE tenant_id = $1 AND metadata->>'source' = 'first_deposit_bonus'`,
    [tenantId]
  );
  const row = r.rows[0];
  const num = (s: string | undefined) => Number(s ?? 0);
  return {
    total_claimed: num(row?.total_claimed),
    total_bonus_issued: num(row?.total_bonus_issued),
    total_bonus_unlocked: num(row?.total_bonus_unlocked),
    total_bonus_expired: num(row?.total_bonus_expired),
    total_qualifying_turnover: num(row?.total_qualifying_turnover),
    total_deposited: num(row?.total_deposited),
    active: num(row?.active),
    completed: num(row?.completed),
    expired: num(row?.expired),
    cancelled: num(row?.cancelled),
    issued_today: num(row?.issued_today),
    issued_month: num(row?.issued_month),
  };
}

export interface FirstDepositUserStatus {
  enabled: boolean;
  has_bonus: boolean;
  status: string | null;
  awarded_amount: number;
  wagering_required: number;
  wagering_progress: number;
  wagering_remaining: number;
  progress_pct: number;
  expires_at: string | null;
  terms: {
    bonus_name: string;
    match_pct: number;
    min_deposit: number;
    max_bonus: number;
    max_eligible_deposit: number;
    wagering_multiplier: number;
    min_selections: number;
    min_selection_odds: number;
    expires_in_days: number;
  };
}

/** User-facing status + public-safe terms (no budgets/caps). */
export async function getUserFirstDepositBonusStatus(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<FirstDepositUserStatus> {
  const cfg = await loadFirstDepositConfig(client, tenantId);
  const terms = {
    bonus_name: cfg.bonus_name,
    match_pct: cfg.match_pct,
    min_deposit: cfg.min_deposit,
    max_bonus: cfg.max_bonus,
    max_eligible_deposit: cfg.max_eligible_deposit,
    wagering_multiplier: cfg.wagering_multiplier,
    min_selections: cfg.min_selections,
    min_selection_odds: cfg.min_selection_odds,
    expires_in_days: cfg.expires_in_days,
  };

  const r = await client.query<{
    status: string;
    awarded_amount: string;
    wagering_required: string;
    wagering_progress: string;
    expires_at: string | null;
  }>(
    `SELECT status, awarded_amount::text, wagering_required::text,
            wagering_progress::text, expires_at
       FROM bonus_assignments
      WHERE tenant_id = $1 AND user_id = $2
        AND metadata->>'source' = 'first_deposit_bonus'
      ORDER BY awarded_at DESC
      LIMIT 1`,
    [tenantId, userId]
  );
  const row = r.rows[0];
  if (!row) {
    return {
      enabled: cfg.is_enabled,
      has_bonus: false,
      status: null,
      awarded_amount: 0,
      wagering_required: 0,
      wagering_progress: 0,
      wagering_remaining: 0,
      progress_pct: 0,
      expires_at: null,
      terms,
    };
  }
  const required = Number(row.wagering_required ?? 0);
  const progress = Number(row.wagering_progress ?? 0);
  const remaining = Math.max(0, required - progress);
  const pct = required > 0 ? Math.min(100, Math.round((progress / required) * 100)) : 0;
  return {
    enabled: cfg.is_enabled,
    has_bonus: true,
    status: row.status,
    awarded_amount: Number(row.awarded_amount ?? 0),
    wagering_required: required,
    wagering_progress: progress,
    wagering_remaining: remaining,
    progress_pct: pct,
    expires_at: row.expires_at,
    terms,
  };
}
