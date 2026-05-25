/**
 * Promotions side-effects triggered by a placed bet.
 *
 *   - Advance wagering_progress on every active bonus_assignment for
 *     this user that is still inside its wagering window. Bets whose
 *     odds fall below the rule's `min_odds` are excluded.
 *
 *   - When `wagering_progress >= wagering_required`, the bonus is
 *     completed: the assignment transitions to `status='completed'` and
 *     the awarded amount moves from bonus_balance → balance with a
 *     ledger entry, mirroring the user-panel claim flow.
 */
import { logger } from '../../infrastructure/logger';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  Events,
  emitToUser,
  emitWalletUpdated,
} from '../../realtime/socket';

interface AssignmentRow {
  id: string;
  bonus_rule_id: string;
  awarded_amount: string;
  wagering_required: string;
  wagering_progress: string;
  status: string;
  rule_type: string;
  config: Record<string, unknown>;
}

export async function applyBetWageringProgress(params: {
  tenantId: string;
  userId: string;
  betId: string;
  stake: number;
  odds: number;
}): Promise<void> {
  if (!Number.isFinite(params.stake) || params.stake <= 0) return;

  try {
    await withTenantClient(
      { tenantId: params.tenantId, bypassRls: true },
      async (client) => {
        const assignments = await client.query<AssignmentRow>(
          `SELECT ba.id,
                  ba.bonus_rule_id,
                  ba.awarded_amount::text,
                  ba.wagering_required::text,
                  ba.wagering_progress::text,
                  ba.status,
                  br.type AS rule_type,
                  br.config
             FROM bonus_assignments ba
             JOIN bonus_rules br ON br.id = ba.bonus_rule_id
            WHERE ba.tenant_id = $1
              AND ba.user_id = $2
              AND ba.status = 'active'
              AND ba.wagering_required > 0
              AND (ba.expires_at IS NULL OR ba.expires_at > now())
            ORDER BY ba.awarded_at ASC
            FOR UPDATE OF ba`,
          [params.tenantId, params.userId]
        );
        if (assignments.rows.length === 0) return;

        for (const a of assignments.rows) {
          const required = Number(a.wagering_required ?? 0);
          if (required <= 0) continue;
          const cfg = (a.config ?? {}) as Record<string, unknown>;
          const minOdds = Number(cfg.min_odds ?? 0);
          if (minOdds > 0 && params.odds < minOdds) continue;

          const currentProgress = Number(a.wagering_progress ?? 0);
          const remaining = Math.max(0, required - currentProgress);
          const credit = Math.min(remaining, params.stake);
          const nextProgress = currentProgress + credit;
          const completed = nextProgress >= required;

          await client.query(
            `UPDATE bonus_assignments
                SET wagering_progress = $1::numeric
              WHERE id = $2`,
            [nextProgress, a.id]
          );

          if (!completed) {
            emitToUser(params.tenantId, params.userId, Events.BONUS_CLAIMED, {
              type: 'wagering_progress',
              assignment_id: a.id,
              wagering_progress: nextProgress,
              wagering_required: required,
            });
            continue;
          }

          // Completion: convert bonus → cash and credit the wallet.
          const award = Number(a.awarded_amount ?? 0);
          await client.query(
            `UPDATE bonus_assignments
                SET status = 'completed',
                    completed_at = now(),
                    wagering_progress = $1::numeric
              WHERE id = $2`,
            [nextProgress, a.id]
          );

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
                        bonus_balance = GREATEST(bonus_balance - $1::numeric, 0)
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
                    source: 'bonus_wagering_complete',
                    bonus_assignment_id: a.id,
                    bonus_rule_id: a.bonus_rule_id,
                    rule_type: a.rule_type,
                    kind: 'bonus_conversion',
                  }),
                ]
              );
              emitWalletUpdated(params.tenantId, params.userId, {
                reason: 'bonus_wagering_complete',
                wallet: { id: w.id, currency: w.currency },
                bonus_assignment_id: a.id,
              });
            }
          }

          emitToUser(params.tenantId, params.userId, Events.BONUS_CLAIMED, {
            type: 'bonus_completed',
            assignment_id: a.id,
            awarded_amount: a.awarded_amount,
          });
        }
      }
    );
  } catch (err) {
    logger.error(
      { err, tenantId: params.tenantId, userId: params.userId, betId: params.betId },
      'wagering progress update failed'
    );
  }
}
