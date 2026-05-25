import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { BadRequestError, ConflictError, UnauthorizedError } from '../../../http/errors/http-error';
import { authenticateToken } from '../../../middleware/authenticate';

const router = Router();

const listQuery = z.object({
  status: z.enum(['Active', 'Upcoming', 'Completed']).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const subscribeSchema = z.object({
  pick_id: z.string().uuid(),
});

type AuthedRequest = Request & { user?: { sub?: string } };

function requireUserId(req: AuthedRequest): string {
  const userId = req.user?.id ?? req.user?.sub;
  if (!userId) throw new UnauthorizedError('Authentication required');
  return userId;
}

function requireTenantId(req: Request): string {
  const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;
  if (!tenantId) throw new BadRequestError('Tenant context required');
  return tenantId;
}

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

router.get(
  '/',
  wrap(async (req) => {
    const tenantId = requireTenantId(req);
    const q = listQuery.parse(req.query);
    return withTenantClient({ tenantId }, async (client) => {
      const values: unknown[] = [tenantId];
      const filters = ['gp.tenant_id = $1', 'gp.is_active = true'];
      let i = 2;
      if (q.status) {
        filters.push(`gp.status = $${i++}`);
        values.push(q.status);
      }
      const limit = q.limit ?? 50;
      values.push(limit);
      const rows = await client.query(
        `SELECT gp.id, gp.game, gp.type, gp.prediction, gp.confidence, gp.subscribers,
                gp.status, gp.start_time, gp.result
           FROM game_picks gp
          WHERE ${filters.join(' AND ')}
          ORDER BY gp.start_time DESC NULLS LAST
          LIMIT $${i}`,
        values
      );
      return { items: rows.rows };
    });
  })
);

router.post(
  '/subscribe',
  authenticateToken(),
  wrapStatus(201, async (req) => {
    const tenantId = requireTenantId(req);
    const userId = requireUserId(req as AuthedRequest);
    const body = subscribeSchema.parse(req.body);
    return withTenantClient({ tenantId }, async (client) => {
      const pick = await client.query(
        `SELECT id FROM game_picks WHERE id = $1 AND tenant_id = $2`,
        [body.pick_id, tenantId]
      );
      if (!pick.rows[0]) throw new ConflictError('Pick not found');

      await client.query(
        `INSERT INTO game_pick_subscriptions (tenant_id, user_id, pick_id)
         VALUES ($1,$2,$3)
         ON CONFLICT (tenant_id, user_id, pick_id) DO NOTHING`,
        [tenantId, userId, body.pick_id]
      );
      await client.query(
        `UPDATE game_picks
            SET subscribers = (
              SELECT COUNT(*)::int
              FROM game_pick_subscriptions
              WHERE tenant_id = $1 AND pick_id = $2
            ),
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, body.pick_id]
      );
      return { ok: true };
    });
  })
);

router.post(
  '/unsubscribe',
  authenticateToken(),
  wrap(async (req) => {
    const tenantId = requireTenantId(req);
    const userId = requireUserId(req as AuthedRequest);
    const body = subscribeSchema.parse(req.body);
    return withTenantClient({ tenantId }, async (client) => {
      await client.query(
        `DELETE FROM game_pick_subscriptions
          WHERE tenant_id = $1 AND user_id = $2 AND pick_id = $3`,
        [tenantId, userId, body.pick_id]
      );
      await client.query(
        `UPDATE game_picks
            SET subscribers = (
              SELECT COUNT(*)::int
              FROM game_pick_subscriptions
              WHERE tenant_id = $1 AND pick_id = $2
            ),
                updated_at = now()
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, body.pick_id]
      );
      return { ok: true };
    });
  })
);

export default router;
