import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { ConflictError, NotFoundError } from '../../../http/errors/http-error';
import { getAdminScope, requireScopedTenantId } from '../admin-shared';

const router = Router();

const idParam = z.object({ id: z.string().uuid() });
const listQuery = z.object({
  status: z.enum(['active', 'upcoming', 'completed', 'analysis']).optional(),
});
const createSchema = z.object({
  game: z.string().trim().min(1).max(200),
  type: z.string().trim().min(1).max(50),
  prediction: z.string().trim().min(1).max(200),
  confidence: z.coerce.number().int().min(1).max(100),
  status: z.enum(['Active', 'Upcoming', 'Completed', 'Cancelled']).default('Active'),
  start_time: z.coerce.date(),
});
const updateSchema = createSchema.partial();
const resultSchema = z.object({
  result: z.enum(['Won', 'Lost', 'Void']),
});

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

function toDbStatus(input?: string): string | null {
  if (!input) return null;
  if (input === 'active') return 'Active';
  if (input === 'upcoming') return 'Upcoming';
  if (input === 'completed') return 'Completed';
  if (input === 'analysis') return null;
  return null;
}

router.get(
  '/',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const q = listQuery.parse(req.query);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const filters = ['tenant_id = $1'];
      const values: unknown[] = [tenantId];
      let i = 2;
      const st = toDbStatus(q.status);
      if (st) {
        filters.push(`status = $${i++}`);
        values.push(st);
      }
      const where = `WHERE ${filters.join(' AND ')}`;
      const rows = await client.query(
        `SELECT id, game, type, prediction, confidence, subscribers, status, start_time, result, created_at
           FROM game_picks
           ${where}
         ORDER BY start_time DESC NULLS LAST, created_at DESC`,
        values
      );
      return rows.rows;
    });
  })
);

router.post(
  '/',
  wrapStatus(201, async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = createSchema.parse(req.body);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const row = await client.query(
        `INSERT INTO game_picks (
           tenant_id, bucket, event_id, casino_game_id, display_order, is_active,
           game, type, prediction, confidence, subscribers, status, start_time, created_by
         ) VALUES (
           $1,'featured',NULL,NULL,100,true,
           $2,$3,$4,$5,0,$6,$7,$8
         )
         RETURNING id, game, type, prediction, confidence, subscribers, status, start_time, result, created_at`,
        [tenantId, body.game, body.type, body.prediction, body.confidence, body.status, body.start_time, scope.actorId]
      );
      return row.rows[0];
    });
  })
);

router.put(
  '/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const { id } = idParam.parse(req.params);
    const body = updateSchema.parse(req.body);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        sets.push(`${k} = $${i++}`);
        values.push(v);
      }
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id);
      values.push(tenantId);
      const row = await client.query(
        `UPDATE game_picks SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $${i++} AND tenant_id = $${i}
         RETURNING id, game, type, prediction, confidence, subscribers, status, start_time, result, created_at`,
        values
      );
      if (!row.rows[0]) throw new NotFoundError('Game pick not found');
      return row.rows[0];
    });
  })
);

router.patch(
  '/:id/result',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const { id } = idParam.parse(req.params);
    const body = resultSchema.parse(req.body);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const row = await client.query(
        `UPDATE game_picks
            SET result = $1,
                status = 'Completed',
                updated_at = now()
          WHERE id = $2 AND tenant_id = $3
          RETURNING id, game, type, prediction, confidence, subscribers, status, start_time, result, created_at`,
        [body.result, id, tenantId]
      );
      if (!row.rows[0]) throw new NotFoundError('Game pick not found');
      return row.rows[0];
    });
  })
);

router.delete(
  '/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const { id } = idParam.parse(req.params);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const del = await client.query(
        `DELETE FROM game_picks WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );
      if (!del.rows[0]) throw new NotFoundError('Game pick not found');
      return { id };
    });
  })
);

export default router;
