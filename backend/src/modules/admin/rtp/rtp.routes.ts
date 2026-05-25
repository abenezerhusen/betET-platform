/**
 * Section 15 — RTP Management (internal game engine only).
 *
 * Spec endpoints (admin-only, mounted at /api/admin/games/rtp* via
 * /api/admin):
 *
 *   GET    /api/admin/games/rtp                — list internal games + overrides
 *   PATCH  /api/admin/games/:id/rtp            — update default_rtp OR per-client override
 *   PATCH  /api/admin/games/:id/status         — Active / Disabled (affects /api/games/lobby)
 *
 * Spec endpoints (public / engine-side, mounted under /api/games/* in app.ts):
 *
 *   GET    /api/games/lobby                    — public list of Active internal + external games
 *   GET    /api/games/rtp/:gameId              — game-engine workers read effective RTP per round
 *
 * The internal_games table is global; admin RTP changes propagate to every
 * tenant immediately. Per-tenant tuning lives in game_rtp_overrides via the
 * tenant's slug as client_id.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { BadRequestError, NotFoundError } from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { getAdminScope, getIp, getUa } from '../admin-shared';

const router = Router();

const gameIdParam = z.object({ id: z.string().min(1).max(50) });

const rtpUpdateSchema = z.object({
  rtp: z.coerce.number().min(50).max(99),
  apply_global: z.boolean().default(true),
  client_id: z.string().trim().min(1).max(80).nullable().optional(),
});

const statusUpdateSchema = z.object({
  status: z.enum(['Active', 'Disabled']),
});

const wrap =
  <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

interface InternalGameRow {
  id: string;
  name: string;
  provider: string;
  default_rtp: string;
  min_rtp: string;
  max_rtp: string;
  status: 'Active' | 'Disabled';
  min_bet: string;
  max_bet: string;
  slug: string | null;
  thumbnail_url: string | null;
  description: string | null;
  game_type: string | null;
}

interface OverrideRow {
  id: string;
  game_id: string;
  client_id: string;
  rtp: string;
  updated_at: string;
}

function shapeGame(g: InternalGameRow, overrides: OverrideRow[]) {
  const own = overrides.filter((o) => o.game_id === g.id);
  return {
    id: g.id,
    name: g.name,
    provider: g.provider,
    defaultRtp: Number(g.default_rtp),
    minRtp: Number(g.min_rtp),
    maxRtp: Number(g.max_rtp),
    status: g.status,
    minBet: Number(g.min_bet),
    maxBet: Number(g.max_bet),
    slug: g.slug,
    thumbnail_url: g.thumbnail_url,
    description: g.description,
    gameType: g.game_type,
    clientOverrides: own.map((o) => ({
      clientId: o.client_id,
      rtp: Number(o.rtp),
      updatedAt: o.updated_at,
    })),
  };
}

router.get(
  '/rtp',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    return withTenantClient(
      { tenantId: scope.tenantId, bypassRls: true },
      async (client) => {
        const games = await client.query<InternalGameRow>(
          `SELECT id, name, provider, default_rtp::text, min_rtp::text, max_rtp::text,
                  status, min_bet::text, max_bet::text, slug, thumbnail_url,
                  description, game_type
             FROM internal_games
             ORDER BY name`
        );
        const overrides = await client.query<OverrideRow>(
          `SELECT id, game_id, client_id, rtp::text, updated_at
             FROM game_rtp_overrides
             ORDER BY updated_at DESC`
        );
        return games.rows.map((g) => shapeGame(g, overrides.rows));
      }
    );
  })
);

router.patch(
  '/:id/rtp',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = gameIdParam.parse(req.params);
    const body = rtpUpdateSchema.parse(req.body);

    const result = await withTenantClient(
      { tenantId: scope.tenantId, bypassRls: true },
      async (client) => {
        const gameQ = await client.query<InternalGameRow>(
          `SELECT id, name, provider, default_rtp::text, min_rtp::text, max_rtp::text,
                  status, min_bet::text, max_bet::text, slug, thumbnail_url, description, game_type
             FROM internal_games WHERE id = $1`,
          [id]
        );
        const game = gameQ.rows[0];
        if (!game) throw new NotFoundError('Internal game not found');

        const min = Number(game.min_rtp);
        const max = Number(game.max_rtp);
        if (body.rtp < min || body.rtp > max) {
          throw new BadRequestError(
            `RTP must be between ${min}% and ${max}%`,
            { min, max, requested: body.rtp }
          );
        }

        if (body.apply_global) {
          await client.query(
            `UPDATE internal_games
                SET default_rtp = $2::numeric, updated_at = now()
              WHERE id = $1`,
            [id, body.rtp]
          );
        } else {
          const clientId = body.client_id ?? '';
          if (!clientId.trim()) {
            throw new BadRequestError(
              'client_id is required when apply_global = false'
            );
          }
          await client.query(
            `INSERT INTO game_rtp_overrides (game_id, client_id, rtp, updated_by)
             VALUES ($1, $2, $3::numeric, $4)
             ON CONFLICT (game_id, client_id) DO UPDATE
             SET rtp = EXCLUDED.rtp, updated_by = EXCLUDED.updated_by, updated_at = now()`,
            [id, clientId.trim(), body.rtp, scope.actorId]
          );
        }

        const after = await client.query<InternalGameRow>(
          `SELECT id, name, provider, default_rtp::text, min_rtp::text, max_rtp::text,
                  status, min_bet::text, max_bet::text, slug, thumbnail_url, description, game_type
             FROM internal_games WHERE id = $1`,
          [id]
        );
        const overrides = await client.query<OverrideRow>(
          `SELECT id, game_id, client_id, rtp::text, updated_at
             FROM game_rtp_overrides WHERE game_id = $1`,
          [id]
        );
        return shapeGame(after.rows[0], overrides.rows);
      }
    );

    void tryAudit(
      {
        tenantId: scope.tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.rtp.update',
        resource: 'internal_games',
        resourceId: id,
        payload: {
          rtp: body.rtp,
          apply_global: body.apply_global,
          client_id: body.apply_global ? null : body.client_id,
        },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );

    return { ok: true, game: result };
  })
);

router.patch(
  '/:id/status',
  wrap(async (req) => {
    const scope = getAdminScope(req);
    const { id } = gameIdParam.parse(req.params);
    const body = statusUpdateSchema.parse(req.body);

    const result = await withTenantClient(
      { tenantId: scope.tenantId, bypassRls: true },
      async (client) => {
        const r = await client.query<InternalGameRow>(
          `UPDATE internal_games
              SET status = $2, updated_at = now()
            WHERE id = $1
            RETURNING id, name, provider, default_rtp::text, min_rtp::text, max_rtp::text,
                      status, min_bet::text, max_bet::text, slug, thumbnail_url, description, game_type`,
          [id, body.status]
        );
        if (!r.rows[0]) throw new NotFoundError('Internal game not found');
        return r.rows[0];
      }
    );

    void tryAudit(
      {
        tenantId: scope.tenantId,
        actorId: scope.actorId,
        actorType: scope.actorType,
        action: 'admin.rtp.status',
        resource: 'internal_games',
        resourceId: id,
        payload: { status: body.status },
        ip: getIp(req),
        userAgent: getUa(req),
        status: 'success',
      },
      { bypassRls: true }
    );

    return { ok: true, id, status: result.status };
  })
);

export default router;
