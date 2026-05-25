import { Router, type Request, type Response, type NextFunction } from 'express';
import { betPlacementRateLimiter } from '../../middleware/rate-limiters';
import { betIdParamSchema, couponCodeParamSchema, placeBetSchema } from './user.dto';
import { getBet, getBetByCouponCode, placeBet } from './bets.service';
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
