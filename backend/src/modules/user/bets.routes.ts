import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { betPlacementRateLimiter } from '../../middleware/rate-limiters';
import { betIdParamSchema, couponCodeParamSchema, placeBetSchema } from './user.dto';
import { getBet, getBetByCouponCode, placeBet } from './bets.service';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { getUserScope } from './user-shared';
import * as repo from './user.repository';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'post',
  path: '/api/user/bets/place',
  summary: 'Place a user bet',
  description:
    'Places a new bet with duplicate protection using `idempotency_key`. Re-sending the same key within 5 minutes returns the original bet.',
  tags: ['User Bets'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['game_id', 'stake', 'idempotency_key'],
          properties: {
            game_id: { type: 'string', format: 'uuid' },
            session_id: { type: 'string', format: 'uuid' },
            stake: { oneOf: [{ type: 'string' }, { type: 'number' }] },
            potential_win: { oneOf: [{ type: 'string' }, { type: 'number' }] },
            currency: { type: 'string', example: 'ETB' },
            selection: { type: 'object', additionalProperties: true },
            metadata: { type: 'object', additionalProperties: true },
            idempotency_key: {
              type: 'string',
              format: 'uuid',
              description: 'Client-generated key to prevent accidental duplicate bets.',
            },
          },
        },
      },
    },
  },
  responses: {
    '201': { description: 'Bet created' },
    '200': { description: 'Duplicate request; original bet returned' },
    '400': { description: 'Validation / business rule error' },
    '401': { description: 'Authentication required' },
  },
});

router.post('/place', betPlacementRateLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = placeBetSchema.parse(req.body);
    const out = await placeBet(req, body);
    res.status(out.idempotent ? 200 : 201).json(out);
  } catch (err) {
    next(err);
  }
});

/* GET /api/user/bets — list the authenticated user's internal game bets */
const listQuery = z.object({
  page:   z.coerce.number().int().min(1).default(1),
  limit:  z.coerce.number().int().min(1).max(200).default(50),
  status: z.string().optional(),
  from:   z.coerce.date().optional(),
  to:     z.coerce.date().optional(),
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getUserScope(req);
    const q = listQuery.parse(req.query);
    const offset = (q.page - 1) * q.limit;

    const result = await withTenantClient({ tenantId: scope.tenantId }, async (client) => {
      const { rows, total } = await repo.listUserBets(client, scope.tenantId, scope.userId, {
        status: q.status ?? null,
        gameId: null,
        from:   q.from ?? null,
        to:     q.to   ?? null,
        limit:  q.limit,
        offset,
      });

      // Enrich with game name in a single lookup
      const gameIds = [...new Set(rows.map((r) => r.game_id).filter(Boolean))];
      let gameNames: Record<string, string> = {};
      if (gameIds.length > 0) {
        const gamesRes = await client.query<{ id: string; name: string }>(
          `SELECT id, name FROM games WHERE id = ANY($1::uuid[])`,
          [gameIds]
        );
        gameNames = Object.fromEntries(gamesRes.rows.map((g) => [g.id, g.name]));
      }

      return {
        items: rows.map((r) => ({
          ...r,
          game_name: r.game_id ? (gameNames[r.game_id] ?? 'Game') : 'Game',
          placed_at: r.placed_at instanceof Date ? r.placed_at.toISOString() : r.placed_at,
          settled_at: r.settled_at instanceof Date ? r.settled_at?.toISOString() : r.settled_at,
        })),
        total,
        page:  q.page,
        limit: q.limit,
      };
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/coupon/:code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = couponCodeParamSchema.parse(req.params);
    const out = await getBetByCouponCode(req, code);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = betIdParamSchema.parse(req.params);
    const out = await getBet(req, id);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
