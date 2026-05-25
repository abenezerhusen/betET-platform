/**
 * /api/user/tournaments
 *
 * User-facing surface that lets end-users see active tournaments and join
 * them. Mirrors the spec § Tournaments → Manage Tournaments → "User Panel:
 * users can see and join active tournaments".
 *
 * Listing returns every scheduled/running/paused tournament for the tenant
 * plus the caller's entry state (rank + score) when they have one.
 *
 * Joining is idempotent: the unique constraint on
 * (tournament_id, user_id) means a duplicate join just returns the existing
 * entry. When the tournament has a non-zero entry_fee we deduct it from the
 * caller's primary wallet inside the same transaction so a failure rolls
 * back the row insert atomically.
 */

import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../http/errors/http-error';
import { emitToUser } from '../../realtime/socket';
import { getUserScope } from './user-shared';

const idParam = z.object({ id: z.string().uuid() });

const wrap =
  <T>(fn: (req: Request) => Promise<T>) =>
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

interface PublicTournamentRow {
  id: string;
  name: string;
  description: string | null;
  kind: string;
  format: string;
  status: string;
  starts_at: Date | null;
  ends_at: Date | null;
  entry_fee: string;
  prize_pool: string;
  currency: string;
  max_entries: number | null;
  participants: number;
  joined: boolean;
  my_rank: number | null;
  my_score: string | null;
}

const router = Router();

router.get(
  '/',
  wrap(async (req) => {
    const scope = getUserScope(req);
    return withTenantClient({ tenantId: scope.tenantId }, async (client) => {
      const rows = await client.query<PublicTournamentRow>(
        `SELECT t.id,
                t.name,
                t.description,
                t.kind,
                COALESCE(t.rules->>'format', 'leaderboard') AS format,
                t.status,
                t.starts_at,
                t.ends_at,
                t.entry_fee::text,
                t.prize_pool::text,
                t.currency,
                t.max_entries,
                COALESCE(
                  (SELECT COUNT(*)::int FROM tournament_entries te
                    WHERE te.tournament_id = t.id AND te.status = 'active'),
                  0
                ) AS participants,
                EXISTS (
                  SELECT 1 FROM tournament_entries te
                   WHERE te.tournament_id = t.id AND te.user_id = $2
                ) AS joined,
                (SELECT rank FROM tournament_entries
                  WHERE tournament_id = t.id AND user_id = $2) AS my_rank,
                (SELECT score::text FROM tournament_entries
                  WHERE tournament_id = t.id AND user_id = $2) AS my_score
           FROM tournaments t
          WHERE t.tenant_id = $1
            AND t.status IN ('scheduled', 'running', 'paused')
          ORDER BY t.starts_at ASC NULLS LAST, t.created_at DESC
          LIMIT 100`,
        [scope.tenantId, scope.userId]
      );
      return { items: rows.rows };
    });
  })
);

router.post(
  '/:id/join',
  wrapStatus(201, async (req) => {
    const { id } = idParam.parse(req.params);
    const scope = getUserScope(req);

    return withTenantClient({ tenantId: scope.tenantId }, async (client) => {
      const t = await client.query<{
        id: string;
        tenant_id: string;
        status: string;
        entry_fee: string;
        currency: string;
        max_entries: number | null;
        name: string;
      }>(
        `SELECT id, tenant_id, status, entry_fee::text AS entry_fee, currency,
                max_entries, name
           FROM tournaments
          WHERE id = $1 AND tenant_id = $2
          FOR UPDATE`,
        [id, scope.tenantId]
      );
      if (!t.rows[0]) throw new NotFoundError('Tournament not found');
      const tour = t.rows[0];
      if (!['scheduled', 'running', 'paused'].includes(tour.status)) {
        throw new BadRequestError(
          `Tournament is ${tour.status} — cannot join`,
          { status: tour.status }
        );
      }

      // Capacity check.
      if (tour.max_entries && tour.max_entries > 0) {
        const cnt = await client.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM tournament_entries
            WHERE tournament_id = $1 AND status = 'active'`,
          [id]
        );
        if (Number(cnt.rows[0]?.count ?? 0) >= tour.max_entries) {
          throw new ConflictError('Tournament is full');
        }
      }

      // Existing entry? Idempotent return.
      const existing = await client.query(
        `SELECT id, tournament_id, user_id, score::text, rank, status,
                metadata, joined_at, updated_at
           FROM tournament_entries
          WHERE tournament_id = $1 AND user_id = $2`,
        [id, scope.userId]
      );
      if (existing.rows[0]) return existing.rows[0];

      // Charge entry fee from primary wallet (if any).
      const fee = Number(tour.entry_fee);
      if (fee > 0) {
        const wallet = await client.query<{
          id: string;
          currency: string;
          balance: string;
        }>(
          `SELECT id, currency, balance::text FROM wallets
            WHERE tenant_id = $1 AND user_id = $2
            ORDER BY created_at ASC LIMIT 1 FOR UPDATE`,
          [scope.tenantId, scope.userId]
        );
        const w = wallet.rows[0];
        if (!w) throw new BadRequestError('No wallet found to charge entry fee');
        if (Number(w.balance) < fee) {
          throw new BadRequestError('Insufficient balance for tournament entry');
        }
        const before = Number(w.balance);
        await client.query(
          `UPDATE wallets SET balance = balance - $1::numeric WHERE id = $2`,
          [fee, w.id]
        );
        await client.query(
          `INSERT INTO transactions
             (tenant_id, wallet_id, user_id, type, amount,
              before_balance, after_balance, currency, status, metadata)
           VALUES ($1,$2,$3,'adjustment',$4::numeric,
                   $5::numeric,$6::numeric,$7,'completed',$8::jsonb)`,
          [
            scope.tenantId,
            w.id,
            scope.userId,
            -fee,
            before,
            before - fee,
            w.currency,
            JSON.stringify({
              source: 'tournament_entry',
              tournament_id: id,
              tournament_name: tour.name,
            }),
          ]
        );
      }

      const inserted = await client.query(
        `INSERT INTO tournament_entries (
           tenant_id, tournament_id, user_id, metadata, status
         ) VALUES ($1, $2, $3, '{}'::jsonb, 'active')
         ON CONFLICT (tournament_id, user_id) DO UPDATE
           SET status = 'active'
         RETURNING id, tournament_id, user_id, score::text, rank, status,
                   metadata, joined_at, updated_at`,
        [scope.tenantId, id, scope.userId]
      );

      emitToUser(scope.tenantId, scope.userId, 'TOURNAMENT_JOINED', {
        tournament_id: id,
        entry_fee: fee,
      });
      return inserted.rows[0];
    });
  })
);

router.get(
  '/:id/leaderboard',
  wrap(async (req) => {
    const { id } = idParam.parse(req.params);
    const scope = getUserScope(req);
    return withTenantClient({ tenantId: scope.tenantId }, async (client) => {
      const t = await client.query<{ id: string }>(
        `SELECT id FROM tournaments WHERE id = $1 AND tenant_id = $2`,
        [id, scope.tenantId]
      );
      if (!t.rows[0]) throw new NotFoundError('Tournament not found');
      const rows = await client.query(
        `SELECT te.id, te.user_id, te.score::text, te.rank, te.status, te.joined_at,
                COALESCE(NULLIF(u.email, ''), u.phone, u.id::text) AS display_name
           FROM tournament_entries te
           LEFT JOIN users u ON u.id = te.user_id
          WHERE te.tournament_id = $1
          ORDER BY te.rank NULLS LAST, te.score DESC, te.joined_at ASC
          LIMIT 200`,
        [id]
      );
      return { tournament_id: id, items: rows.rows };
    });
  })
);

export default router;
