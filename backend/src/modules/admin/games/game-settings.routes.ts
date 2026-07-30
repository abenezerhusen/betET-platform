/**
 * Admin game-settings routes — Rain Bonus config (Fast Keno & Aviator) and the
 * Fast Keno betting countdown. Stored in the generic `settings` table:
 *   games.rain.<gameId>       → RainConfig
 *   games.countdown.fast-keno → { betting_seconds }
 *
 * Mounted under /api/admin/games (see games.routes.ts), so the effective paths
 * are:
 *   GET/PUT /api/admin/games/rain/:game
 *   GET/PUT /api/admin/games/countdown/fast-keno
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { getAdminScope, requireScopedTenantId } from '../admin-shared';
import { DEFAULT_RAIN_CONFIG, normalizeRainConfig } from '../../../services/rain.service';

const router = Router();

const wrap =
  <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const rainGame = z.enum(['fast-keno', 'aviator']);

const rainConfigSchema = z.object({
  is_enabled: z.boolean().default(false),
  pool_amount: z.coerce.number().min(0).max(10_000_000).default(500),
  per_claim_amount: z.coerce.number().min(0).max(1_000_000).default(5),
  distribution: z.enum(['equal', 'random']).default('equal'),
  max_claims: z.coerce.number().int().min(1).max(100_000).default(10),
  rains_per_day: z.coerce.number().int().min(1).max(1440).default(20),
  window_start: z.string().trim().max(5).default(''),
  window_end: z.string().trim().max(5).default(''),
  claim_deadline_seconds: z.coerce.number().int().min(10).max(86_400).default(600),
  credit_target: z.enum(['bonus', 'main']).default('bonus'),
  min_balance: z.coerce.number().min(0).max(1_000_000).default(0),
  min_wager_today: z.coerce.number().min(0).max(1_000_000).default(0),
  min_account_age_days: z.coerce.number().int().min(0).max(3650).default(0),
  currency: z.string().trim().min(1).max(8).default('ETB'),
});

const countdownSchema = z.object({
  betting_seconds: z.coerce.number().int().min(5).max(300).default(30),
});

const DEFAULT_COUNTDOWN = { betting_seconds: 30 };

router.get(
  '/rain/:game',
  wrap(async (req) => {
    const game = rainGame.parse(req.params.game);
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const row = await client.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2`,
        [tenantId, `games.rain.${game}`]
      );
      return normalizeRainConfig(row.rows[0]?.value ?? DEFAULT_RAIN_CONFIG);
    });
  })
);

router.put(
  '/rain/:game',
  wrap(async (req) => {
    const game = rainGame.parse(req.params.game);
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = rainConfigSchema.parse(req.body);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      await client.query(
        `INSERT INTO settings (tenant_id, key, value)
         VALUES ($1,$2,$3::jsonb)
         ON CONFLICT (tenant_id,key) DO UPDATE
           SET value = EXCLUDED.value, updated_at = now()`,
        [tenantId, `games.rain.${game}`, JSON.stringify(body)]
      );
      return body;
    });
  })
);

router.get(
  '/countdown/fast-keno',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const row = await client.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'games.countdown.fast-keno'`,
        [tenantId]
      );
      return { ...DEFAULT_COUNTDOWN, ...(row.rows[0]?.value ?? {}) };
    });
  })
);

router.put(
  '/countdown/fast-keno',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = countdownSchema.parse(req.body);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      await client.query(
        `INSERT INTO settings (tenant_id, key, value)
         VALUES ($1,'games.countdown.fast-keno',$2::jsonb)
         ON CONFLICT (tenant_id,key) DO UPDATE
           SET value = EXCLUDED.value, updated_at = now()`,
        [tenantId, JSON.stringify(body)]
      );
      return body;
    });
  })
);

export default router;
