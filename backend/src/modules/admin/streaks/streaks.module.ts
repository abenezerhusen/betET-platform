import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { logger } from '../../../infrastructure/logger';
import { emitToUser, Events } from '../../../realtime/socket';
import { NotFoundError } from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

const idParamSchema = z.object({ id: z.string().uuid() });

const configSchema = z.object({
  enabled: z.boolean().default(true),
  streak_days: z.number().int().positive(),
  reward_type: z.enum(['free_bet', 'cash', 'multiplier']),
  reward_amount: z.number().nonnegative(),
  min_bet_daily: z.number().nonnegative().default(10),
});

const updateConfigSchema = configSchema.partial();

/* -------------------------------------------------------------------------- */
/* Unified Streak Config (Section 12 spec)                                     */
/*                                                                             */
/* The spec describes Streak Settings as a single page that holds:             */
/*   - global toggles (enabled, auto_notify, reset_on_loss, reset_on_cancel)   */
/*   - global thresholds (min_bet_amount, required_wins)                       */
/*   - reward tiers (3-day, 5-day, 10-day, etc.)                               */
/* The global block lives in `tournament_streak_settings.config` (jsonb).      */
/* Tiers live in `streak_configs` rows.                                        */
/* -------------------------------------------------------------------------- */

interface StreakGlobalSettings {
  enabled: boolean;
  min_bet_amount: number;
  required_wins: number;
  reset_on_loss: boolean;
  reset_on_cancel: boolean;
  auto_notify: boolean;
}

const DEFAULT_GLOBAL_SETTINGS: StreakGlobalSettings = {
  enabled: true,
  min_bet_amount: 10,
  required_wins: 0,
  reset_on_loss: false,
  reset_on_cancel: true,
  auto_notify: true,
};

const globalSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  min_bet_amount: z.number().nonnegative().optional(),
  required_wins: z.number().int().nonnegative().optional(),
  reset_on_loss: z.boolean().optional(),
  reset_on_cancel: z.boolean().optional(),
  auto_notify: z.boolean().optional(),
});

const unifiedTierSchema = z.object({
  id: z.string().uuid().optional(),
  enabled: z.boolean().default(true),
  streak_days: z.number().int().positive(),
  reward_type: z.enum(['free_bet', 'cash', 'multiplier']),
  reward_amount: z.number().nonnegative(),
  min_bet_daily: z.number().nonnegative().default(10),
});

const unifiedConfigSchema = z.object({
  enabled: z.boolean().optional(),
  min_bet_amount: z.number().nonnegative().optional(),
  required_wins: z.number().int().nonnegative().optional(),
  reset_on_loss: z.boolean().optional(),
  reset_on_cancel: z.boolean().optional(),
  auto_notify: z.boolean().optional(),
  tiers: z.array(unifiedTierSchema).optional(),
});

function mergeGlobalSettings(raw: unknown): StreakGlobalSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_GLOBAL_SETTINGS };
  const r = raw as Partial<StreakGlobalSettings>;
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_GLOBAL_SETTINGS.enabled,
    min_bet_amount:
      typeof r.min_bet_amount === 'number'
        ? r.min_bet_amount
        : DEFAULT_GLOBAL_SETTINGS.min_bet_amount,
    required_wins:
      typeof r.required_wins === 'number'
        ? r.required_wins
        : DEFAULT_GLOBAL_SETTINGS.required_wins,
    reset_on_loss:
      typeof r.reset_on_loss === 'boolean'
        ? r.reset_on_loss
        : DEFAULT_GLOBAL_SETTINGS.reset_on_loss,
    reset_on_cancel:
      typeof r.reset_on_cancel === 'boolean'
        ? r.reset_on_cancel
        : DEFAULT_GLOBAL_SETTINGS.reset_on_cancel,
    auto_notify:
      typeof r.auto_notify === 'boolean'
        ? r.auto_notify
        : DEFAULT_GLOBAL_SETTINGS.auto_notify,
  };
}

export async function getStreakGlobalSettings(
  tenantId: string
): Promise<StreakGlobalSettings> {
  return withTenantClient({ tenantId, bypassRls: true }, async (client) => {
    const row = await client.query<{ enabled: boolean; config: Record<string, unknown> }>(
      `SELECT enabled, config FROM tournament_streak_settings WHERE tenant_id = $1`,
      [tenantId]
    );
    const cfg = row.rows[0]?.config ?? {};
    const merged = mergeGlobalSettings(cfg);
    if (row.rows[0] && typeof row.rows[0].enabled === 'boolean') {
      merged.enabled = row.rows[0].enabled;
    }
    return merged;
  });
}

/**
 * Reset a user's current streak (used on cancel / loss when the matching
 * global flag is enabled). Best-effort — never throws into the caller.
 */
export async function resetUserStreak(params: {
  tenantId: string;
  userId: string;
  reason: 'cancel' | 'loss';
}): Promise<void> {
  try {
    const settings = await getStreakGlobalSettings(params.tenantId);
    if (params.reason === 'cancel' && !settings.reset_on_cancel) return;
    if (params.reason === 'loss' && !settings.reset_on_loss) return;
    await withTenantClient({ tenantId: params.tenantId }, async (client) => {
      await client.query(
        `UPDATE user_streaks
            SET current_streak = 0,
                updated_at = now()
          WHERE tenant_id = $1 AND user_id = $2 AND current_streak > 0`,
        [params.tenantId, params.userId]
      );
    });
    if (settings.auto_notify) {
      emitToUser(params.tenantId, params.userId, Events.PUSH_NOTIFICATION, {
        kind: 'streak_reset',
        reason: params.reason,
      });
    }
  } catch (err) {
    logger.warn({ err, ...params }, 'streak reset failed');
  }
}

export async function updateUserStreakProgress(params: {
  tenantId: string;
  userId: string;
  betAmount: number;
  betDate?: Date;
}) {
  const now = params.betDate ?? new Date();
  const betDate = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  const betDateIso = betDate.toISOString().slice(0, 10);
  const yesterdayIso = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1)
  )
    .toISOString()
    .slice(0, 10);

  // Honor the global on/off + min-bet threshold before doing any work.
  const globalSettings = await getStreakGlobalSettings(params.tenantId);
  if (!globalSettings.enabled) return null;
  if (params.betAmount < globalSettings.min_bet_amount) return null;

  return withTenantClient({ tenantId: params.tenantId }, async (client) => {
    const tiersQ = await client.query<{
      streak_days: number;
      reward_type: 'free_bet' | 'cash' | 'multiplier';
      reward_amount: string;
      min_bet_daily: string;
      enabled: boolean;
    }>(
      `SELECT streak_days, reward_type, reward_amount::text, min_bet_daily::text, enabled
         FROM streak_configs
        WHERE tenant_id = $1 AND enabled = true
        ORDER BY streak_days ASC`,
      [params.tenantId]
    );
    if (tiersQ.rows.length === 0) return null;

    const minRequired = Math.min(
      ...tiersQ.rows.map((r) => Number(r.min_bet_daily || 0))
    );
    if (params.betAmount < minRequired) return null;

    const currentQ = await client.query<{
      current_streak: number;
      longest_streak: number;
      last_bet_date: string | null;
      streak_bonus_earned: string;
    }>(
      `SELECT current_streak, longest_streak, last_bet_date::text, streak_bonus_earned::text
         FROM user_streaks
        WHERE tenant_id = $1 AND user_id = $2
        LIMIT 1`,
      [params.tenantId, params.userId]
    );

    const current = currentQ.rows[0];
    if (current?.last_bet_date === betDateIso) return null;

    let newStreak = 1;
    if (current?.last_bet_date === yesterdayIso) {
      newStreak = (current.current_streak ?? 0) + 1;
    }
    const longest = Math.max(newStreak, current?.longest_streak ?? 0);

    await client.query(
      `INSERT INTO user_streaks
         (tenant_id, user_id, current_streak, longest_streak, last_bet_date)
       VALUES ($1, $2, $3, $4, $5::date)
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET
         current_streak = EXCLUDED.current_streak,
         longest_streak = GREATEST(user_streaks.longest_streak, EXCLUDED.longest_streak),
         last_bet_date = EXCLUDED.last_bet_date`,
      [params.tenantId, params.userId, newStreak, longest, betDateIso]
    );

    const reward = tiersQ.rows.find(
      (tier) =>
        tier.streak_days === newStreak &&
        params.betAmount >= Number(tier.min_bet_daily || 0)
    );
    if (!reward) {
      return { current_streak: newStreak, longest_streak: longest, rewarded: false };
    }

    const rewardAmount = Number(reward.reward_amount ?? 0);
    if (rewardAmount <= 0) {
      return { current_streak: newStreak, longest_streak: longest, rewarded: false };
    }

    const walletQ = await client.query<{
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
    const wallet = walletQ.rows[0];
    if (!wallet) return null;

    const beforeBalance = Number(wallet.balance);
    const beforeBonusBalance = Number(wallet.bonus_balance ?? 0);
    if (reward.reward_type === 'cash') {
      await client.query(
        `UPDATE wallets
            SET balance = balance + $1::numeric,
                updated_at = now()
          WHERE id = $2`,
        [rewardAmount, wallet.id]
      );
    } else {
      await client.query(
        `UPDATE wallets
            SET bonus_balance = bonus_balance + $1::numeric,
                updated_at = now()
          WHERE id = $2`,
        [rewardAmount, wallet.id]
      );
    }

    await client.query(
      `UPDATE user_streaks
          SET streak_bonus_earned = streak_bonus_earned + $1::numeric
        WHERE tenant_id = $2 AND user_id = $3`,
      [rewardAmount, params.tenantId, params.userId]
    );

    const txType = reward.reward_type === 'cash' ? 'adjustment' : 'bonus_credit';
    const afterBalance =
      reward.reward_type === 'cash' ? beforeBalance + rewardAmount : beforeBalance;
    const afterBonusBalance =
      reward.reward_type !== 'cash'
        ? beforeBonusBalance + rewardAmount
        : beforeBonusBalance;
    await client.query(
      `INSERT INTO transactions
         (tenant_id, wallet_id, user_id, type, amount, before_balance, after_balance, currency, status, metadata)
       VALUES ($1,$2,$3,$4,$5::numeric,$6::numeric,$7::numeric,$8,'completed',$9::jsonb)`,
      [
        params.tenantId,
        wallet.id,
        params.userId,
        txType,
        rewardAmount,
        reward.reward_type === 'cash' ? beforeBalance : beforeBonusBalance,
        reward.reward_type === 'cash' ? afterBalance : afterBonusBalance,
        wallet.currency,
        JSON.stringify({
          source: 'streak_reward',
          streak_days: reward.streak_days,
          reward_type: reward.reward_type,
        }),
      ]
    );

    // Spec: auto-notify when streak milestone reached.
    if (globalSettings.auto_notify) {
      emitToUser(params.tenantId, params.userId, Events.PUSH_NOTIFICATION, {
        kind: 'streak_reward',
        streak_days: reward.streak_days,
        reward_type: reward.reward_type,
        reward_amount: rewardAmount,
      });
      emitToUser(params.tenantId, params.userId, Events.BONUS_CLAIMED, {
        type: 'streak_reward',
        streak_days: reward.streak_days,
        reward_type: reward.reward_type,
        amount: rewardAmount,
      });
    }

    return {
      current_streak: newStreak,
      longest_streak: longest,
      rewarded: true,
      reward_type: reward.reward_type,
      reward_amount: rewardAmount,
    };
  });
}

const router = Router();

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const wrapStatus =
  <T>(status: number, fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

/**
 * GET /api/admin/streaks/config — spec-aligned unified endpoint.
 *
 * Returns the full streak configuration: global settings + tier list.
 * Frontend uses this single payload to render the page.
 */
router.get(
  '/config',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    return withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const settingsRow = await client.query<{
          enabled: boolean;
          config: Record<string, unknown>;
        }>(
          `SELECT enabled, config FROM tournament_streak_settings WHERE tenant_id = $1`,
          [tenantId]
        );
        const global = mergeGlobalSettings(settingsRow.rows[0]?.config ?? {});
        if (settingsRow.rows[0] && typeof settingsRow.rows[0].enabled === 'boolean') {
          global.enabled = settingsRow.rows[0].enabled;
        }
        const tiers = await client.query(
          `SELECT id, tenant_id, enabled, streak_days, reward_type, reward_amount::text,
                  min_bet_daily::text, created_at, updated_at
             FROM streak_configs
            WHERE tenant_id = $1
            ORDER BY streak_days ASC, created_at ASC`,
          [tenantId]
        );
        return {
          ...global,
          tiers: tiers.rows,
        };
      }
    );
  })
);

/**
 * PUT /api/admin/streaks/config — spec-aligned upsert for the full config.
 *
 * Accepts any subset of global flags + an optional `tiers` array. Tiers are
 * upserted by streak_days; existing tiers not present in the array are
 * untouched (admin removes via `DELETE /config/:id`).
 */
router.put(
  '/config',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = unifiedConfigSchema.parse(req.body);
    return withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const existing = await client.query<{
          enabled: boolean;
          config: Record<string, unknown>;
        }>(
          `SELECT enabled, config FROM tournament_streak_settings WHERE tenant_id = $1`,
          [tenantId]
        );
        const currentGlobal = mergeGlobalSettings(existing.rows[0]?.config ?? {});
        if (existing.rows[0] && typeof existing.rows[0].enabled === 'boolean') {
          currentGlobal.enabled = existing.rows[0].enabled;
        }
        const nextGlobal: StreakGlobalSettings = {
          ...currentGlobal,
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.min_bet_amount !== undefined ? { min_bet_amount: body.min_bet_amount } : {}),
          ...(body.required_wins !== undefined ? { required_wins: body.required_wins } : {}),
          ...(body.reset_on_loss !== undefined ? { reset_on_loss: body.reset_on_loss } : {}),
          ...(body.reset_on_cancel !== undefined ? { reset_on_cancel: body.reset_on_cancel } : {}),
          ...(body.auto_notify !== undefined ? { auto_notify: body.auto_notify } : {}),
        };

        await client.query(
          `INSERT INTO tournament_streak_settings (tenant_id, enabled, config)
             VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (tenant_id) DO UPDATE
             SET enabled = EXCLUDED.enabled,
                 config = EXCLUDED.config`,
          [tenantId, nextGlobal.enabled, JSON.stringify(nextGlobal)]
        );

        if (body.tiers) {
          for (const tier of body.tiers) {
            await client.query(
              `INSERT INTO streak_configs (
                 tenant_id, enabled, streak_days, reward_type, reward_amount, min_bet_daily
               ) VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (tenant_id, streak_days) DO UPDATE
                 SET enabled = EXCLUDED.enabled,
                     reward_type = EXCLUDED.reward_type,
                     reward_amount = EXCLUDED.reward_amount,
                     min_bet_daily = EXCLUDED.min_bet_daily`,
              [
                tenantId,
                tier.enabled,
                tier.streak_days,
                tier.reward_type,
                tier.reward_amount,
                tier.min_bet_daily,
              ]
            );
          }
        }

        void tryAudit(
          {
            tenantId,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.streaks.config.update',
            resource: 'streak_configs',
            resourceId: tenantId,
            payload: { after: { ...nextGlobal, tiers: body.tiers ?? [] } },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );

        const tierRows = await client.query(
          `SELECT id, tenant_id, enabled, streak_days, reward_type, reward_amount::text,
                  min_bet_daily::text, created_at, updated_at
             FROM streak_configs
            WHERE tenant_id = $1
            ORDER BY streak_days ASC, created_at ASC`,
          [tenantId]
        );
        return { ...nextGlobal, tiers: tierRows.rows };
      }
    );
  })
);

/**
 * GET /api/admin/streaks/tiers — returns just the tier rows (no global block).
 * Kept for callers that only need the table.
 */
router.get(
  '/tiers',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const q = await client.query(
          `SELECT id, tenant_id, enabled, streak_days, reward_type, reward_amount::text,
                  min_bet_daily::text, created_at, updated_at
             FROM streak_configs
            ORDER BY streak_days ASC, created_at ASC`
        );
        return { items: q.rows };
      }
    );
  })
);

router.post(
  '/config',
  wrapStatus(201, async (req) => {
    const scope = getAdminScope(req);
    const body = configSchema.parse(req.body);
    const tenantId = requireScopedTenantId(scope);
    return withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const created = await client.query(
          `INSERT INTO streak_configs
             (tenant_id, enabled, streak_days, reward_type, reward_amount, min_bet_daily)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, tenant_id, enabled, streak_days, reward_type, reward_amount::text,
                     min_bet_daily::text, created_at, updated_at`,
          [
            tenantId,
            body.enabled,
            body.streak_days,
            body.reward_type,
            body.reward_amount,
            body.min_bet_daily,
          ]
        );
        const row = created.rows[0];
        void tryAudit(
          {
            tenantId,
            actorId: scope.actorId,
            actorType: scope.actorType,
            action: 'admin.streaks.config.create',
            resource: 'streak_configs',
            resourceId: row.id,
            payload: { after: row },
            ip: getIp(req),
            userAgent: getUa(req),
            status: 'success',
          },
          { bypassRls: true }
        );
        return row;
      }
    );
  })
);

router.put(
  '/config/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParamSchema.parse(req.params);
    const body = updateConfigSchema.parse(req.body);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const sets: string[] = [];
        const values: unknown[] = [];
        let i = 1;
        for (const [k, v] of Object.entries(body)) {
          if (v === undefined) continue;
          sets.push(`${k} = $${i++}`);
          values.push(v);
        }
        if (!sets.length) {
          const existing = await client.query(
            `SELECT id, tenant_id, enabled, streak_days, reward_type, reward_amount::text,
                    min_bet_daily::text, created_at, updated_at
               FROM streak_configs
              WHERE id = $1`,
            [id]
          );
          if (!existing.rows[0]) throw new NotFoundError('Streak tier not found');
          return existing.rows[0];
        }
        values.push(id);
        const updated = await client.query(
          `UPDATE streak_configs
              SET ${sets.join(', ')}
            WHERE id = $${i}
            RETURNING id, tenant_id, enabled, streak_days, reward_type, reward_amount::text,
                      min_bet_daily::text, created_at, updated_at`,
          values
        );
        if (!updated.rows[0]) throw new NotFoundError('Streak tier not found');
        return updated.rows[0];
      }
    );
  })
);

router.delete(
  '/config/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = idParamSchema.parse(req.params);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const deleted = await client.query(
          `DELETE FROM streak_configs WHERE id = $1 RETURNING id`,
          [id]
        );
        if (!deleted.rows[0]) throw new NotFoundError('Streak tier not found');
        return { ok: true, id };
      }
    );
  })
);

router.get(
  '/leaderboard',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        const q = await client.query(
          `SELECT us.user_id,
                  us.current_streak,
                  us.longest_streak,
                  us.last_bet_date,
                  us.streak_bonus_earned::text,
                  u.email AS user_email,
                  u.phone AS user_phone
             FROM user_streaks us
             LEFT JOIN users u ON u.id = us.user_id
            ORDER BY us.current_streak DESC, us.longest_streak DESC, us.updated_at DESC
            LIMIT 200`
        );
        return { items: q.rows };
      }
    );
  })
);

export default router;
