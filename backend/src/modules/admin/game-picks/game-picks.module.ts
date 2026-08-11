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

/* -------------------------------------------------------------------------- */
/*  Top Leagues configuration                                                 */
/*                                                                            */
/*  Admin-managed list of "top leagues" used by Game Picks and the public     */
/*  sports board ordering (and by the odds sync as pricing priority). Not     */
/*  hardcoded: leagues are picked from those actually present in the          */
/*  synchronized database. Falls back to platform defaults when empty.        */
/* -------------------------------------------------------------------------- */

const topLeagueCreateSchema = z.object({
  league: z.string().trim().min(1).max(200),
});
const topLeagueUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  priority: z.coerce.number().int().min(0).max(10000).optional(),
});
const topLeagueReorderSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
});

const TOP_LEAGUE_COLS =
  'id, league, enabled, priority, created_at, updated_at';

// All /top-leagues/* paths are two segments deep, so they can never collide
// with the single-segment '/:id' pick routes registered above.
router.get(
  '/top-leagues',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const rows = await client.query(
        `SELECT ${TOP_LEAGUE_COLS} FROM top_leagues
          WHERE tenant_id = $1
          ORDER BY priority ASC, created_at ASC`,
        [tenantId]
      );
      return rows.rows;
    });
  })
);

/** Distinct leagues present in the synchronized events DB — the picker source. */
router.get(
  '/top-leagues/available',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const search = String((req.query.search as string) ?? '').trim();
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const values: unknown[] = [tenantId];
      let filter = '';
      if (search) {
        values.push(`%${search}%`);
        filter = 'AND league ILIKE $2';
      }
      const rows = await client.query<{ league: string; events: string }>(
        `SELECT league, COUNT(*)::text AS events
           FROM sports_events
          WHERE tenant_id = $1 AND league IS NOT NULL ${filter}
          GROUP BY league
          ORDER BY COUNT(*) DESC, league ASC
          LIMIT 100`,
        values
      );
      return rows.rows.map((r) => ({ league: r.league, events: Number(r.events) }));
    });
  })
);

router.post(
  '/top-leagues',
  wrapStatus(201, async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = topLeagueCreateSchema.parse(req.body);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const row = await client.query(
        `INSERT INTO top_leagues (tenant_id, league, enabled, priority)
         VALUES ($1, $2, true,
                 COALESCE((SELECT MAX(priority) + 1 FROM top_leagues WHERE tenant_id = $1), 0))
         ON CONFLICT (tenant_id, league) DO UPDATE SET enabled = true, updated_at = now()
         RETURNING ${TOP_LEAGUE_COLS}`,
        [tenantId, body.league]
      );
      return row.rows[0];
    });
  })
);

router.put(
  '/top-leagues/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const { id } = idParam.parse(req.params);
    const body = topLeagueUpdateSchema.parse(req.body);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (body.enabled !== undefined) {
        sets.push(`enabled = $${i++}`);
        values.push(body.enabled);
      }
      if (body.priority !== undefined) {
        sets.push(`priority = $${i++}`);
        values.push(body.priority);
      }
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id, tenantId);
      const row = await client.query(
        `UPDATE top_leagues SET ${sets.join(', ')}, updated_at = now()
          WHERE id = $${i++} AND tenant_id = $${i}
          RETURNING ${TOP_LEAGUE_COLS}`,
        values
      );
      if (!row.rows[0]) throw new NotFoundError('Top league not found');
      return row.rows[0];
    });
  })
);

/** Reorder: array of ids in the desired display order (priority = index). */
router.post(
  '/top-leagues/reorder',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = topLeagueReorderSchema.parse(req.body);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      await client.query(
        `UPDATE top_leagues t
            SET priority = v.ord, updated_at = now()
           FROM (SELECT unnest($2::uuid[]) AS id,
                        generate_series(0, array_length($2::uuid[], 1) - 1) AS ord) v
          WHERE t.id = v.id AND t.tenant_id = $1`,
        [tenantId, body.ids]
      );
      const rows = await client.query(
        `SELECT ${TOP_LEAGUE_COLS} FROM top_leagues
          WHERE tenant_id = $1 ORDER BY priority ASC, created_at ASC`,
        [tenantId]
      );
      return rows.rows;
    });
  })
);

router.delete(
  '/top-leagues/:id',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const { id } = idParam.parse(req.params);
    return withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const del = await client.query(
        `DELETE FROM top_leagues WHERE id = $1 AND tenant_id = $2 RETURNING id`,
        [id, tenantId]
      );
      if (!del.rows[0]) throw new NotFoundError('Top league not found');
      return { id };
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
