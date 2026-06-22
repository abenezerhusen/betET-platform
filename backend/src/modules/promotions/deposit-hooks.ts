/**
 * Promotions side-effects triggered by a confirmed deposit.
 *
 * Called by the Telebirr matching service (and any other deposit pipeline)
 * once a wallet credit is committed, this module:
 *
 *   1. Evaluates active bonus_rules for the user and inserts qualifying
 *      bonus_assignments (deposit_match, signup, free_bet, cashback).
 *   2. Auto-creates raffle_tickets for any open raffle whose
 *      `min_deposit` threshold the deposit meets.
 *   3. Promotes the user's pending referrals row (if any) to keep its
 *      `bonus_amount` aligned with the configured referral_config and
 *      mark it ready for an admin /pay action.
 *
 * Every operation is best-effort and isolated from the deposit credit
 * (failures are logged but never reverse the credit). This file is the
 * single source of truth for "what happens after a successful deposit".
 */
import { logger } from '../../infrastructure/logger';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { emitToUser, Events } from '../../realtime/socket';
import { evaluateInternalBonusEvent } from '../admin/bonuses/bonuses.service';
import { awardRaffleTicketsForDeposit } from '../admin/promotions/raffles.routes';

/**
 * Pay the referrer their reward when this is the referred user's first
 * qualifying deposit (>= configured min). Marks referral pending for the
 * admin to /pay, with bonus_amount populated from the tenant referral
 * config (or the affiliates row when the code is an affiliate).
 */
async function promoteReferralOnFirstDeposit(params: {
  tenantId: string;
  userId: string;
  amount: number;
}): Promise<void> {
  await withTenantClient(
    { tenantId: params.tenantId, bypassRls: true },
    async (client) => {
      // 1. Is this user a referred party with an unresolved referral?
      const r = await client.query<{
        id: string;
        referrer_id: string;
        bonus_amount: string;
        status: string;
        code: string | null;
      }>(
        `SELECT id, referrer_id, bonus_amount::text, status, code
           FROM referrals
          WHERE tenant_id = $1 AND referred_id = $2
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE`,
        [params.tenantId, params.userId]
      );
      const ref = r.rows[0];
      if (!ref) return;
      if (ref.status === 'rewarded' || ref.status === 'cancelled') return;

      // 2. Pull the configured reward amount + minimum qualifying deposit.
      const cfgRow = await client.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM settings
          WHERE tenant_id = $1 AND key = 'promotions.referral_config'`,
        [params.tenantId]
      );
      const cfg = cfgRow.rows[0]?.value ?? {
        reward_amount: 10,
        min_deposit_to_qualify: 20,
        reward_type: 'cash',
      };
      const minDeposit = Number(
        (cfg as Record<string, unknown>).min_deposit_to_qualify ?? 0
      );
      const rewardAmount = Number(
        (cfg as Record<string, unknown>).reward_amount ?? 0
      );

      // 3. Has this user already made enough deposits to qualify?
      const depQ = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS total
           FROM transactions
          WHERE tenant_id = $1
            AND user_id = $2
            AND type IN ('deposit', 'telebirr_deposit')
            AND status = 'completed'`,
        [params.tenantId, params.userId]
      );
      const cumulative = Number(depQ.rows[0]?.total ?? 0);
      if (cumulative < minDeposit) return;

      // 4. Check if the referral program is enabled.
      const programEnabled = (cfg as Record<string, unknown>).is_enabled !== false;
      if (!programEnabled) return;

      // 5. Credit the referrer's wallet immediately (auto-reward on qualifying
      //    deposit — no admin action required).
      await client.query(
        `UPDATE referrals
            SET bonus_amount = $1::numeric,
                status = 'rewarded',
                rewarded_at = now(),
                updated_at = now()
          WHERE id = $2`,
        [rewardAmount, ref.id]
      );

      if (rewardAmount > 0) {
        const walletRow = await client.query<{ id: string; balance: string; currency: string }>(
          `SELECT id, balance::text, currency
             FROM wallets
            WHERE tenant_id = $1 AND user_id = $2
            ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
          [params.tenantId, ref.referrer_id]
        );
        if (walletRow.rows[0]) {
          const before = Number(walletRow.rows[0].balance);
          await client.query(
            `UPDATE wallets SET balance = balance + $1::numeric WHERE id = $2`,
            [rewardAmount, walletRow.rows[0].id]
          );
          await client.query(
            `INSERT INTO transactions
               (tenant_id, wallet_id, user_id, type, amount, before_balance,
                after_balance, currency, status, metadata)
             VALUES ($1,$2,$3,'bonus_credit',$4::numeric,$5::numeric,$6::numeric,$7,'completed',$8::jsonb)`,
            [
              params.tenantId,
              walletRow.rows[0].id,
              ref.referrer_id,
              rewardAmount,
              before,
              before + rewardAmount,
              walletRow.rows[0].currency,
              JSON.stringify({
                source: 'referral_auto_reward',
                referral_id: ref.id,
                referred_user_id: params.userId,
                kind: 'referral_reward',
              }),
            ]
          );
        }

        // Emit real-time notification to the referrer.
        emitToUser(params.tenantId, ref.referrer_id, Events.BONUS_CLAIMED, {
          type: 'referral_reward',
          referral_id: ref.id,
          amount: rewardAmount,
        });
      }

      // 6. Bump the affiliate's earnings_total too if this code belonged to
      //    an affiliate account (so Affiliates → Payments shows accruals).
      if (ref.code) {
        await client.query(
          `UPDATE affiliates
              SET earnings_total = earnings_total + $1::numeric,
                  updated_at = now()
            WHERE tenant_id = $2 AND code = $3 AND status = 'active'`,
          [rewardAmount, params.tenantId, ref.code]
        );
      }
    }
  );
}

/**
 * Run every post-deposit promotion hook. Each step is wrapped so a failure
 * in one path doesn't cascade — promotions are advisory, not transactional.
 */
export async function runPostDepositPromotions(params: {
  tenantId: string;
  userId: string;
  amount: number | string;
  source?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const amountNum =
    typeof params.amount === 'number' ? params.amount : Number(params.amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) return;

  // 1. Bonus rules evaluation.
  try {
    const out = await evaluateInternalBonusEvent({
      tenant_id: params.tenantId,
      user_id: params.userId,
      event_type: 'deposit',
      amount: amountNum,
      metadata: {
        source: params.source ?? 'deposit_hook',
        ...(params.metadata ?? {}),
      },
    });
    for (const a of out.assignments) {
      emitToUser(params.tenantId, params.userId, Events.BONUS_CLAIMED, {
        type: 'bonus_awarded',
        assignment_id: a.id,
        bonus_rule_id: a.bonus_rule_id,
        amount: a.awarded_amount,
        wagering_required: a.wagering_required,
        expires_at: a.expires_at,
      });
    }
  } catch (err) {
    logger.error(
      { err, tenantId: params.tenantId, userId: params.userId },
      'post-deposit bonus evaluation failed'
    );
  }

  // 2. Raffle ticket awards.
  try {
    const awarded = await awardRaffleTicketsForDeposit({
      tenantId: params.tenantId,
      userId: params.userId,
      amount: amountNum,
    });
    for (const t of awarded) {
      emitToUser(params.tenantId, params.userId, Events.BONUS_CLAIMED, {
        type: 'raffle_ticket_awarded',
        raffle_id: t.raffle_id,
        ticket_number: t.ticket_number,
      });
    }
  } catch (err) {
    logger.error(
      { err, tenantId: params.tenantId, userId: params.userId },
      'post-deposit raffle ticket award failed'
    );
  }

  // 3. Referral reward (pending → ready to /pay).
  try {
    await promoteReferralOnFirstDeposit({
      tenantId: params.tenantId,
      userId: params.userId,
      amount: amountNum,
    });
  } catch (err) {
    logger.error(
      { err, tenantId: params.tenantId, userId: params.userId },
      'post-deposit referral promotion failed'
    );
  }
}
