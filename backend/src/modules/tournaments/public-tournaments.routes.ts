import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../http/errors/http-error';
import { authenticateToken } from '../../middleware/authenticate';
import * as swagger from '../../swagger/registry';

const idParamSchema = z.object({ id: z.string().uuid() });

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/tournaments',
  summary: 'List public tournaments',
  tags: ['Tournaments'],
  security: [],
  responses: { '200': { description: 'Active/upcoming tournaments' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/tournaments/{id}/join',
  summary: 'Join tournament',
  tags: ['Tournaments'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Joined tournament' },
    '409': { description: 'Already joined or full' },
  },
});

swagger.registerPath({
  method: 'get',
  path: '/api/tournaments/{id}/leaderboard',
  summary: 'Tournament leaderboard',
  tags: ['Tournaments'],
  security: [],
  responses: { '200': { description: 'Leaderboard' } },
});

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

router.get(
  '/',
  wrap(async (req) => {
    const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;
    if (!tenantId) throw new BadRequestError('Tenant context required');
    return withTenantClient({ tenantId }, async (client) => {
      const r = await client.query(
        `SELECT id, tenant_id, name, description, kind, status, starts_at, ends_at,
                entry_fee::text, prize_pool::text, currency, max_entries, rules, leaderboard,
                created_by, created_at, updated_at
           FROM tournaments
          WHERE tenant_id = $1
            AND status IN ('scheduled', 'running')
          ORDER BY COALESCE(starts_at, created_at) ASC, created_at DESC`,
        [tenantId]
      );
      return { items: r.rows };
    });
  })
);

router.post(
  '/:id/join',
  authenticateToken(),
  wrap(async (req) => {
    const { id } = idParamSchema.parse(req.params);
    if (!req.user?.id || !req.user?.tenantId) {
      throw new BadRequestError('Authenticated user is required');
    }
    const tenantId = req.user.tenantId;
    const userId = req.user.id;

    return withTenantClient({ tenantId }, async (client) => {
      const tQ = await client.query<{
        id: string;
        status: string;
        max_entries: number | null;
        entry_fee: string;
      }>(
        `SELECT id, status, max_entries, entry_fee::text
           FROM tournaments
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      const t = tQ.rows[0];
      if (!t) throw new NotFoundError('Tournament not found');
      if (!['scheduled', 'running'].includes(t.status)) {
        throw new ConflictError('Tournament is not open for registration');
      }
      if (t.max_entries) {
        const c = await client.query<{ c: number }>(
          `SELECT COUNT(*)::int AS c
             FROM tournament_entries
            WHERE tournament_id = $1`,
          [id]
        );
        if ((c.rows[0]?.c ?? 0) >= t.max_entries) {
          throw new ConflictError('Tournament is full');
        }
      }

      const walletQ = await client.query<{
        id: string;
        balance: string;
        currency: string;
      }>(
        `SELECT id, balance::text, currency
           FROM wallets
          WHERE tenant_id = $1 AND user_id = $2
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE`,
        [tenantId, userId]
      );
      const wallet = walletQ.rows[0];
      if (!wallet) throw new BadRequestError('Wallet not found');

      const entryFee = Number(t.entry_fee ?? '0');
      const balance = Number(wallet.balance ?? 0);
      if (entryFee > 0 && balance < entryFee) {
        throw new BadRequestError('Insufficient balance for tournament entry');
      }

      let entry;
      try {
        const ins = await client.query(
          `INSERT INTO tournament_entries (tenant_id, tournament_id, user_id)
           VALUES ($1, $2, $3)
           RETURNING id, tenant_id, tournament_id, user_id, score::text, rank, status, joined_at, updated_at`,
          [tenantId, id, userId]
        );
        entry = ins.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('User already joined this tournament');
        }
        throw err;
      }

      if (entryFee > 0) {
        await client.query(
          `UPDATE wallets
              SET balance = balance - $1::numeric
            WHERE id = $2`,
          [entryFee, wallet.id]
        );
        await client.query(
          `INSERT INTO transactions
             (tenant_id, wallet_id, user_id, type, amount, before_balance, after_balance, currency, status, metadata)
           VALUES ($1,$2,$3,'bet_stake',$4::numeric,$5::numeric,$6::numeric,$7,'completed',$8::jsonb)`,
          [
            tenantId,
            wallet.id,
            userId,
            `-${entryFee}`,
            balance,
            balance - entryFee,
            wallet.currency,
            JSON.stringify({
              source: 'tournament_join',
              tournament_id: id,
              entry_id: entry.id,
            }),
          ]
        );
      }

      return { tournament_id: id, entry };
    });
  })
);

router.get(
  '/:id/leaderboard',
  wrap(async (req) => {
    const { id } = idParamSchema.parse(req.params);
    const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;
    if (!tenantId) throw new BadRequestError('Tenant context required');
    return withTenantClient({ tenantId }, async (client) => {
      const tQ = await client.query<{ id: string }>(
        `SELECT id FROM tournaments WHERE id = $1 LIMIT 1`,
        [id]
      );
      if (!tQ.rows[0]) throw new NotFoundError('Tournament not found');
      const rows = await client.query(
        `SELECT user_id, score::text, rank, status, joined_at
           FROM tournament_entries
          WHERE tournament_id = $1
          ORDER BY rank NULLS LAST, score DESC, joined_at ASC`,
        [id]
      );
      return { tournament_id: id, items: rows.rows };
    });
  })
);

export default router;
