/**
 * Section 24 Step 1/2 — affiliate revenue-share accrual hooks.
 *
 * When a referred user's bet settles, the referring affiliate accrues
 * commission according to their `plan`:
 *
 *   - revenue_share / hybrid: commission_pct of (stake - paid_out) on
 *     every settlement (lost bets contribute full stake, won bets
 *     contribute negative if payout exceeds stake — clamped at 0 so
 *     we never reverse already-paid commission).
 *   - cpa: only the one-shot CPA payment at first deposit; per-bet
 *     accruals are intentionally skipped.
 *
 * The accrual bumps `affiliates.earnings_total` (the running unpaid
 * balance surfaced in Admin Panel → Affiliates → Payments). The actual
 * cash payout is gated by the admin /pay action; this module never
 * touches a wallet directly.
 *
 * All updates are best-effort: a failure here never reverses a
 * committed bet or settlement.
 */
import type { PoolClient } from 'pg';
import { logger } from '../../infrastructure/logger';
import { withTenantClient } from '../../infrastructure/db/tenant-client';

interface AffiliateRow {
  id: string;
  plan: string;
  commission_pct: string;
}

async function findAffiliateForUser(
  client: PoolClient,
  tenantId: string,
  userId: string
): Promise<AffiliateRow | null> {
  const r = await client.query<AffiliateRow>(
    `SELECT a.id, a.plan, a.commission_pct::text
       FROM referrals r
       JOIN affiliates a
         ON a.tenant_id = r.tenant_id
        AND a.code = r.code
        AND a.status = 'active'
      WHERE r.tenant_id = $1
        AND r.referred_id = $2
      ORDER BY r.created_at ASC
      LIMIT 1`,
    [tenantId, userId]
  );
  return r.rows[0] ?? null;
}

/**
 * Accrue affiliate revenue-share when a settled bet's house margin is
 * known. Call once per bet at settlement, with the gross paid-out
 * amount (0 for a lost bet, full payout for a won bet, stake for a
 * voided bet).
 */
export async function accrueAffiliateOnBetSettle(params: {
  tenantId: string;
  userId: string;
  betId: string;
  stake: number;
  payout: number;
}): Promise<void> {
  if (!Number.isFinite(params.stake) || params.stake <= 0) return;
  try {
    await withTenantClient(
      { tenantId: params.tenantId, bypassRls: true },
      async (client) => {
        const aff = await findAffiliateForUser(
          client,
          params.tenantId,
          params.userId
        );
        if (!aff) return;
        if (aff.plan === 'cpa') return; // CPA-only affiliates accrue at signup, not per bet.

        const netHouse = Math.max(0, params.stake - params.payout);
        if (netHouse <= 0) return;

        const pct = Number(aff.commission_pct ?? 0);
        if (!Number.isFinite(pct) || pct <= 0) return;

        const commission = Math.round(((netHouse * pct) / 100) * 100) / 100;
        if (commission <= 0) return;

        await client.query(
          `UPDATE affiliates
              SET earnings_total = earnings_total + $1::numeric,
                  updated_at = now()
            WHERE id = $2`,
          [commission, aff.id]
        );
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
      'affiliate revenue-share accrual failed'
    );
  }
}
