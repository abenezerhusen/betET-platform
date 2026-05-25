import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { emitToAdmins, emitToTenant } from '../../../realtime/socket';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

/* -------------------------------------------------------------------------- */
/* DTOs                                                                        */
/* -------------------------------------------------------------------------- */

const idParam = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  status: z
    .enum(['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'])
    .optional(),
  kind: z.enum(['sportsbook', 'casino', 'streak', 'jackpot']).optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional(),
  kind: z.enum(['sportsbook', 'casino', 'streak', 'jackpot']).default('sportsbook'),
  status: z
    .enum(['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled'])
    .default('draft'),
  starts_at: z.coerce.date().optional(),
  ends_at: z.coerce.date().optional(),
  entry_fee: z.number().nonnegative().default(0),
  prize_pool: z.number().nonnegative().default(0),
  currency: z.string().trim().min(1).max(8).default('ETB'),
  max_entries: z.number().int().positive().optional(),
  rules: z.record(z.unknown()).default({}),
});

const updateSchema = createSchema.partial();

const enterSchema = z.object({
  user_id: z.string().uuid(),
  metadata: z.record(z.unknown()).default({}),
});

const updateScoreSchema = z.object({
  score: z.number(),
  rank: z.number().int().nonnegative().optional(),
});

const patchStatusSchema = z.object({
  status: z.enum(['scheduled', 'running', 'completed', 'cancelled', 'paused']),
});

const streakSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
});

/* -------------------------------------------------------------------------- */
/* Repository helpers                                                          */
/* -------------------------------------------------------------------------- */

interface TournamentRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  kind: string;
  status: string;
  starts_at: Date | null;
  ends_at: Date | null;
  entry_fee: string;
  prize_pool: string;
  currency: string;
  max_entries: number | null;
  rules: Record<string, unknown>;
  leaderboard: unknown[];
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const TOURNAMENT_COLS = `
  id, tenant_id, name, description, kind, status, starts_at, ends_at,
  entry_fee, prize_pool, currency, max_entries, rules, leaderboard,
  created_by, created_at, updated_at
`;

async function getById(client: PoolClient, id: string): Promise<TournamentRow | null> {
  const r = await client.query<TournamentRow>(
    `SELECT ${TOURNAMENT_COLS} FROM tournaments WHERE id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Service                                                                     */
/* -------------------------------------------------------------------------- */

async function listTournaments(req: Request, q: z.infer<typeof listQuery>) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (q.status) {
        filters.push(`status = $${i++}`);
        values.push(q.status);
      }
      if (q.kind) {
        filters.push(`kind = $${i++}`);
        values.push(q.kind);
      }
      if (q.search) {
        filters.push(`name ILIKE $${i++}`);
        values.push(`%${q.search}%`);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const total = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM tournaments ${where}`,
        values
      );
      const rows = await client.query<TournamentRow>(
        `SELECT ${TOURNAMENT_COLS} FROM tournaments ${where}
           ORDER BY COALESCE(starts_at, created_at) DESC, created_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );
      return {
        items: rows.rows,
        total: Number(total.rows[0]?.count ?? 0),
        page: q.page,
        limit: q.limit,
      };
    }
  );
}

async function createTournament(req: Request, body: z.infer<typeof createSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query<TournamentRow>(
        `INSERT INTO tournaments (
           tenant_id, name, description, kind, status, starts_at, ends_at,
           entry_fee, prize_pool, currency, max_entries, rules, created_by
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
         RETURNING ${TOURNAMENT_COLS}`,
        [
          tenantId,
          body.name,
          body.description ?? null,
          body.kind,
          body.status,
          body.starts_at ?? null,
          body.ends_at ?? null,
          body.entry_fee,
          body.prize_pool,
          body.currency,
          body.max_entries ?? null,
          JSON.stringify(body.rules),
          scope.actorId,
        ]
      );
      const created = r.rows[0];
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.tournament.create',
          resource: 'tournaments',
          resourceId: created.id,
          payload: { after: created },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      emitToAdmins(tenantId, 'TOURNAMENT_CREATED', { tournament: created });
      return created;
    }
  );
}

async function updateTournament(
  req: Request,
  id: string,
  patch: z.infer<typeof updateSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await getById(client, id);
      if (!before) throw new NotFoundError('Tournament not found');

      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      const cast: Record<string, string> = { rules: '::jsonb' };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) continue;
        sets.push(`${k} = $${i++}${cast[k] ?? ''}`);
        values.push(k === 'rules' ? JSON.stringify(v) : v);
      }
      if (!sets.length) return before;
      values.push(id);
      const r = await client.query<TournamentRow>(
        `UPDATE tournaments SET ${sets.join(', ')}
           WHERE id = $${i}
           RETURNING ${TOURNAMENT_COLS}`,
        values
      );
      const after = r.rows[0];
      void tryAudit(
        {
          tenantId: before.tenant_id,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.tournament.update',
          resource: 'tournaments',
          resourceId: id,
          payload: { before, after },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      emitToTenant(before.tenant_id, 'TOURNAMENT_UPDATED', { tournament: after });
      return after;
    }
  );
}

async function deleteTournament(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await getById(client, id);
      if (!before) throw new NotFoundError('Tournament not found');
      await client.query(`DELETE FROM tournaments WHERE id = $1`, [id]);
      void tryAudit(
        {
          tenantId: before.tenant_id,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.tournament.delete',
          resource: 'tournaments',
          resourceId: id,
          payload: { before },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return { ok: true };
    }
  );
}

async function listEntries(req: Request, tournamentId: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT te.id, te.tournament_id, te.user_id, te.score, te.rank, te.status,
                te.metadata, te.joined_at, te.updated_at,
                u.email AS user_email, u.phone AS user_phone
           FROM tournament_entries te
           LEFT JOIN users u ON u.id = te.user_id
           WHERE te.tournament_id = $1
           ORDER BY te.rank NULLS LAST, te.score DESC`,
        [tournamentId]
      );
      return { items: r.rows };
    }
  );
}

async function addEntry(
  req: Request,
  tournamentId: string,
  body: z.infer<typeof enterSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const t = await getById(client, tournamentId);
      if (!t) throw new NotFoundError('Tournament not found');
      try {
        const r = await client.query(
          `INSERT INTO tournament_entries (
             tenant_id, tournament_id, user_id, metadata, status
           ) VALUES ($1,$2,$3,$4::jsonb,'active')
           RETURNING id, tenant_id, tournament_id, user_id, score, rank, status,
                     metadata, joined_at, updated_at`,
          [t.tenant_id, tournamentId, body.user_id, JSON.stringify(body.metadata)]
        );
        return r.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('User is already entered in this tournament');
        }
        throw err;
      }
    }
  );
}

async function updateScore(
  req: Request,
  entryId: string,
  body: z.infer<typeof updateScoreSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `UPDATE tournament_entries SET score = $1, rank = COALESCE($2, rank)
           WHERE id = $3
           RETURNING id, tournament_id, user_id, score, rank, status, metadata,
                     joined_at, updated_at`,
        [body.score, body.rank ?? null, entryId]
      );
      if (!r.rows[0]) throw new NotFoundError('Tournament entry not found');
      return r.rows[0];
    }
  );
}

async function removeEntry(req: Request, entryId: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `DELETE FROM tournament_entries WHERE id = $1 RETURNING tournament_id`,
        [entryId]
      );
      if (!r.rows[0]) throw new NotFoundError('Tournament entry not found');
      return { ok: true };
    }
  );
}

async function patchTournamentStatus(
  req: Request,
  id: string,
  body: z.infer<typeof patchStatusSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const t = await getById(client, id);
      if (!t) throw new NotFoundError('Tournament not found');
      const r = await client.query<TournamentRow>(
        `UPDATE tournaments
            SET status = $1,
                updated_at = now()
          WHERE id = $2
          RETURNING ${TOURNAMENT_COLS}`,
        [body.status, id]
      );
      return r.rows[0];
    }
  );
}

async function getTournamentLeaderboard(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const t = await getById(client, id);
      if (!t) throw new NotFoundError('Tournament not found');
      const rows = await client.query(
        `SELECT te.id, te.user_id, te.score::text, te.rank, te.status, te.joined_at,
                u.email AS user_email, u.phone AS user_phone
           FROM tournament_entries te
           LEFT JOIN users u ON u.id = te.user_id
          WHERE te.tournament_id = $1
          ORDER BY te.rank NULLS LAST, te.score DESC, te.joined_at ASC`,
        [id]
      );
      return { tournament_id: id, items: rows.rows };
    }
  );
}

/**
 * POST /:id/complete
 *
 * Spec § Manage Tournaments → Complete Tournament:
 *   settle winners, distribute prizes.
 *
 * The prize distribution follows `rules.payout_structure` (array of decimal
 * fractions that sum to 1.0). When that is absent the prize_pool is split
 * 50/30/20 across the top 3 ranked entries. Winners' wallets are credited
 * with a `bonus_credit` transaction tagged `source=tournament_prize`.
 */
async function completeTournament(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const t = await getById(client, id);
      if (!t) throw new NotFoundError('Tournament not found');
      if (t.status === 'completed') {
        return { tournament: t, payouts: [], note: 'already_completed' };
      }

      // Final rank: order by current score desc, then earliest joiner first.
      const lb = await client.query<{
        id: string;
        user_id: string;
        score: string;
      }>(
        `SELECT id, user_id, score::text
           FROM tournament_entries
          WHERE tournament_id = $1 AND status = 'active'
          ORDER BY score DESC, joined_at ASC`,
        [id]
      );

      // Persist final ranks back onto the entries.
      let r = 1;
      for (const row of lb.rows) {
        await client.query(
          `UPDATE tournament_entries SET rank = $1 WHERE id = $2`,
          [r++, row.id]
        );
      }

      // Payout structure: rules.payout_structure or default 50/30/20.
      const ruleStructure = (t.rules as Record<string, unknown>)?.payout_structure;
      const defaultStructure = [0.5, 0.3, 0.2];
      const structure =
        Array.isArray(ruleStructure) && ruleStructure.every((v) => typeof v === 'number')
          ? (ruleStructure as number[])
          : defaultStructure;
      const prizePool = Number(t.prize_pool ?? 0);
      const payouts: Array<{
        rank: number;
        entry_id: string;
        user_id: string;
        amount: number;
        transaction_id: string | null;
      }> = [];

      for (let i = 0; i < Math.min(structure.length, lb.rows.length); i++) {
        const entry = lb.rows[i];
        const amount = Math.round(prizePool * structure[i] * 100) / 100;
        if (amount <= 0) continue;

        // Credit the winner's wallet with a bonus_credit transaction.
        const wallet = await client.query<{
          id: string;
          currency: string;
          balance: string;
        }>(
          `SELECT id, currency, balance::text
             FROM wallets
            WHERE tenant_id = $1 AND user_id = $2
            ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
          [t.tenant_id, entry.user_id]
        );
        const w = wallet.rows[0];
        let txId: string | null = null;
        if (w) {
          const before = Number(w.balance);
          await client.query(
            `UPDATE wallets SET balance = balance + $1::numeric WHERE id = $2`,
            [amount, w.id]
          );
          const tx = await client.query<{ id: string }>(
            `INSERT INTO transactions
               (tenant_id, wallet_id, user_id, type, amount,
                before_balance, after_balance, currency, status, metadata)
             VALUES ($1,$2,$3,'bonus_credit',$4::numeric,
                     $5::numeric,$6::numeric,$7,'completed',$8::jsonb)
             RETURNING id`,
            [
              t.tenant_id,
              w.id,
              entry.user_id,
              amount,
              before,
              before + amount,
              w.currency,
              JSON.stringify({
                source: 'tournament_prize',
                tournament_id: id,
                tournament_name: t.name,
                rank: i + 1,
              }),
            ]
          );
          txId = tx.rows[0]?.id ?? null;
        }
        payouts.push({
          rank: i + 1,
          entry_id: entry.id,
          user_id: entry.user_id,
          amount,
          transaction_id: txId,
        });
      }

      const completed = await client.query<TournamentRow>(
        `UPDATE tournaments
            SET status = 'completed',
                ends_at = COALESCE(ends_at, now()),
                updated_at = now()
          WHERE id = $1
          RETURNING ${TOURNAMENT_COLS}`,
        [id]
      );

      void tryAudit(
        {
          tenantId: t.tenant_id,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.tournament.complete',
          resource: 'tournaments',
          resourceId: id,
          payload: { payouts, structure },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );

      for (const p of payouts) {
        emitToTenant(t.tenant_id, 'TOURNAMENT_PRIZE_AWARDED', {
          tournament_id: id,
          user_id: p.user_id,
          rank: p.rank,
          amount: p.amount,
        });
      }

      return { tournament: completed.rows[0], payouts };
    }
  );
}

async function getStreakSettings(req: Request) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT tenant_id, enabled, config, created_at, updated_at
           FROM tournament_streak_settings WHERE tenant_id = $1`,
        [tenantId]
      );
      if (r.rows[0]) return r.rows[0];
      const ins = await client.query(
        `INSERT INTO tournament_streak_settings (tenant_id) VALUES ($1)
         ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
         RETURNING tenant_id, enabled, config, created_at, updated_at`,
        [tenantId]
      );
      return ins.rows[0];
    }
  );
}

async function updateStreakSettings(
  req: Request,
  body: z.infer<typeof streakSettingsSchema>
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      await client.query(
        `INSERT INTO tournament_streak_settings (tenant_id, enabled, config)
         VALUES ($1, COALESCE($2, true), COALESCE($3::jsonb, '{}'::jsonb))
         ON CONFLICT (tenant_id) DO UPDATE
           SET enabled = COALESCE($2, tournament_streak_settings.enabled),
               config = COALESCE($3::jsonb, tournament_streak_settings.config)`,
        [
          tenantId,
          body.enabled ?? null,
          body.config ? JSON.stringify(body.config) : null,
        ]
      );
      const r = await client.query(
        `SELECT tenant_id, enabled, config, created_at, updated_at
           FROM tournament_streak_settings WHERE tenant_id = $1`,
        [tenantId]
      );
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.tournament_streak.update',
          resource: 'tournament_streak_settings',
          resourceId: tenantId,
          payload: { after: body },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return r.rows[0];
    }
  );
}


/* -------------------------------------------------------------------------- */
/* Routes                                                                      */
/* -------------------------------------------------------------------------- */

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

router.get('/streak-settings', wrap((req) => getStreakSettings(req)));
router.put(
  '/streak-settings',
  wrap((req) => updateStreakSettings(req, streakSettingsSchema.parse(req.body)))
);

router.get('/', wrap((req) => listTournaments(req, listQuery.parse(req.query))));
router.post(
  '/',
  wrapStatus(201, (req) => createTournament(req, createSchema.parse(req.body)))
);
router.get(
  '/:id',
  wrap(async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      {
        tenantId: getAdminScope(req).tenantId,
        bypassRls: getAdminScope(req).bypassRls,
      },
      async (client) => {
        const t = await getById(client, id);
        if (!t) throw new NotFoundError('Tournament not found');
        return t;
      }
    );
  })
);
router.put(
  '/:id',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return updateTournament(req, id, updateSchema.parse(req.body));
  })
);
router.patch(
  '/:id/status',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return patchTournamentStatus(req, id, patchStatusSchema.parse(req.body));
  })
);
router.delete(
  '/:id',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return deleteTournament(req, id);
  })
);
router.get(
  '/:id/leaderboard',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return getTournamentLeaderboard(req, id);
  })
);

router.post(
  '/:id/complete',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return completeTournament(req, id);
  })
);

router.get(
  '/:id/entries',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return listEntries(req, id);
  })
);
router.post(
  '/:id/entries',
  wrapStatus(201, (req) => {
    const { id } = idParam.parse(req.params);
    return addEntry(req, id, enterSchema.parse(req.body));
  })
);
router.put(
  '/entries/:id/score',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return updateScore(req, id, updateScoreSchema.parse(req.body));
  })
);
router.delete(
  '/entries/:id',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return removeEntry(req, id);
  })
);

export default router;
