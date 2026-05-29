/**
 * Section 24 Step 5 — weekly + monthly cashback worker.
 *
 * Runs as an in-process scheduler that ticks once per minute. To avoid
 * pulling in `node-cron` as a new dependency we use a small timer plus
 * a UTC-day dedupe key so each schedule fires at most once per real
 * tick (Sunday 00:00 UTC for the weekly job, last calendar day at
 * 00:00 UTC for the monthly job).
 *
 * For every active tenant the worker:
 *   1. Loads `promotions.bonus_settings` to pick up
 *      cashback.{schedule, min_loss, pct, payout_as}.
 *   2. Sums every user's net losses (bet_stake debits less bet_win
 *      credits) inside the relevant window from `transactions`.
 *   3. Skips users whose losses are below `min_loss`.
 *   4. Writes a `bonus_credit` ledger entry crediting either
 *      `balance` (payout_as='cash') or `bonus_balance`
 *      (payout_as='bonus') and emits a realtime notification.
 *
 * Failures are logged per tenant; one tenant's failure never stops the
 * loop for the rest. Idempotency is enforced inside each window by
 * inspecting recent `transactions` with metadata.kind = 'cashback'.
 */
import { logger } from '../infrastructure/logger';
import { withTenantClient } from '../infrastructure/db/tenant-client';
import { pool } from '../infrastructure/db/pool';
import { emitToUser, emitWalletUpdated, Events } from '../realtime/socket';

interface BonusSettings {
  cashback?: {
    schedule?: 'weekly' | 'monthly';
    payout_as?: 'bonus' | 'cash';
    min_loss?: number;
    pct?: number;
  };
}

interface CashbackResult {
  user_id: string;
  loss: number;
  cashback: number;
}

const DEFAULTS = {
  schedule: 'weekly' as const,
  payout_as: 'bonus' as const,
  min_loss: 100,
  pct: 10,
};

const firedToday = new Map<string, string>();

function utcDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function isLastDayOfMonth(d: Date): boolean {
  const next = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
  );
  return next.getUTCDate() === 1;
}

async function listTenantIds(): Promise<string[]> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE status = 'active'`
  );
  return r.rows.map((row) => row.id);
}

/**
 * Process cashback for a single tenant + schedule (weekly | monthly).
 * Exported so admin can trigger it manually from a future button.
 */
export async function processTenantCashback(params: {
  tenantId: string;
  schedule: 'weekly' | 'monthly';
}): Promise<CashbackResult[]> {
  return withTenantClient(
    { tenantId: params.tenantId, bypassRls: true },
    async (client) => {
      const settingsRow = await client.query<{ value: BonusSettings }>(
        `SELECT value FROM settings
          WHERE tenant_id = $1 AND key = 'promotions.bonus_settings'`,
        [params.tenantId]
      );
      const cfg = settingsRow.rows[0]?.value?.cashback ?? {};
      const schedule = cfg.schedule ?? DEFAULTS.schedule;
      if (schedule !== params.schedule) return [];

      const minLoss = Number(cfg.min_loss ?? DEFAULTS.min_loss);
      const pct = Number(cfg.pct ?? DEFAULTS.pct);
      const payoutAs = cfg.payout_as ?? DEFAULTS.payout_as;
      if (!Number.isFinite(pct) || pct <= 0) return [];

      const windowDays = params.schedule === 'weekly' ? 7 : 30;

      const losses = await client.query<{
        user_id: string;
        net_loss: string;
      }>(
        `SELECT user_id,
                GREATEST(
                  -COALESCE(SUM(CASE WHEN type = 'bet_stake' THEN amount END), 0)
                  - COALESCE(SUM(CASE WHEN type IN ('bet_win', 'bet_refund', 'bet_cashout') THEN amount END), 0),
                  0
                )::text AS net_loss
           FROM transactions
          WHERE tenant_id = $1
            AND type IN ('bet_stake', 'bet_win', 'bet_refund', 'bet_cashout')
            AND status = 'completed'
            AND created_at >= now() - ($2 || ' days')::interval
          GROUP BY user_id`,
        [params.tenantId, String(windowDays)]
      );

      const results: CashbackResult[] = [];

      for (const row of losses.rows) {
        const loss = Number(row.net_loss ?? 0);
        if (!Number.isFinite(loss) || loss < minLoss) continue;

        const cashback = Math.round(((loss * pct) / 100) * 100) / 100;
        if (cashback <= 0) continue;

        // Dedupe inside the current period.
        const existing = await client.query<{ id: string }>(
          `SELECT id FROM transactions
            WHERE tenant_id = $1
              AND user_id = $2
              AND type = 'bonus_credit'
              AND metadata->>'kind' = 'cashback'
              AND metadata->>'schedule' = $3
              AND created_at >= now() - ($4 || ' days')::interval
            LIMIT 1`,
          [params.tenantId, row.user_id, schedule, String(windowDays - 1)]
        );
        if (existing.rows[0]) continue;

        const wallet = await client.query<{
          id: string;
          balance: string;
          bonus_balance: string;
          currency: string;
        }>(
          `SELECT id, balance::text, bonus_balance::text, currency
             FROM wallets
            WHERE tenant_id = $1 AND user_id = $2
            ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
          [params.tenantId, row.user_id]
        );
        const w = wallet.rows[0];
        if (!w) continue;

        const beforeBalance = Number(w.balance);
        const beforeBonus = Number(w.bonus_balance);
        let afterBalance = beforeBalance;
        let afterBonus = beforeBonus;

        if (payoutAs === 'cash') {
          afterBalance = Math.round((beforeBalance + cashback) * 100) / 100;
          await client.query(
            `UPDATE wallets SET balance = $1, updated_at = now() WHERE id = $2`,
            [afterBalance, w.id]
          );
        } else {
          afterBonus = Math.round((beforeBonus + cashback) * 100) / 100;
          await client.query(
            `UPDATE wallets SET bonus_balance = $1, updated_at = now() WHERE id = $2`,
            [afterBonus, w.id]
          );
        }

        await client.query(
          `INSERT INTO transactions
             (tenant_id, wallet_id, user_id, type, amount,
              before_balance, after_balance, currency, status, metadata)
           VALUES ($1, $2, $3, 'bonus_credit', $4::numeric,
                   $5::numeric, $6::numeric, $7, 'completed', $8::jsonb)`,
          [
            params.tenantId,
            w.id,
            row.user_id,
            cashback,
            beforeBalance,
            payoutAs === 'cash' ? afterBalance : beforeBalance,
            w.currency,
            JSON.stringify({
              kind: 'cashback',
              schedule,
              window_days: windowDays,
              pct,
              loss_used: loss,
              payout_as: payoutAs,
            }),
          ]
        );

        emitWalletUpdated(params.tenantId, row.user_id, {
          reason: 'cashback_awarded',
          wallet: {
            id: w.id,
            currency: w.currency,
            balance: afterBalance,
            bonus_balance: afterBonus,
          },
          schedule,
          amount: cashback,
        });
        emitToUser(params.tenantId, row.user_id, Events.BONUS_CLAIMED, {
          type: 'cashback_awarded',
          schedule,
          amount: cashback,
          payout_as: payoutAs,
        });

        results.push({ user_id: row.user_id, loss, cashback });
      }

      return results;
    }
  );
}

async function runAllTenants(schedule: 'weekly' | 'monthly'): Promise<void> {
  let tenantIds: string[];
  try {
    tenantIds = await listTenantIds();
  } catch (err) {
    logger.error({ err, schedule }, 'cashback worker failed to list tenants');
    return;
  }
  for (const tenantId of tenantIds) {
    try {
      const out = await processTenantCashback({ tenantId, schedule });
      logger.info(
        { tenantId, schedule, awarded: out.length },
        'cashback batch processed'
      );
    } catch (err) {
      logger.error({ err, tenantId, schedule }, 'cashback batch failed');
    }
  }
}

let timer: NodeJS.Timeout | null = null;

function tick(): void {
  const now = new Date();
  const dayKey = utcDateKey(now);

  // Weekly: every Sunday at 00:00 UTC.
  if (
    now.getUTCDay() === 0 &&
    now.getUTCHours() === 0 &&
    firedToday.get('weekly') !== dayKey
  ) {
    firedToday.set('weekly', dayKey);
    void runAllTenants('weekly');
  }

  // Monthly: on the last calendar day of the month at 00:00 UTC.
  if (
    isLastDayOfMonth(now) &&
    now.getUTCHours() === 0 &&
    firedToday.get('monthly') !== dayKey
  ) {
    firedToday.set('monthly', dayKey);
    void runAllTenants('monthly');
  }

  // Prune dedupe map so it never grows beyond a handful of keys.
  if (firedToday.size > 8) {
    for (const [k, v] of firedToday) {
      if (v !== dayKey) firedToday.delete(k);
    }
  }
}

export function startCashbackLoop(): void {
  if (timer) return;
  timer = setInterval(tick, 60_000);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info(
    'cashback loop started (weekly Sun 00:00 UTC + monthly last-day 00:00 UTC)'
  );
}

export function stopCashbackLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
