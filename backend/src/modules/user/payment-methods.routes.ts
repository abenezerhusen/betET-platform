import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { z } from 'zod';
import * as swagger from '../../swagger/registry';

import { listPaymentMethodsForUser } from '../payments';
import { getUserScope } from './user-shared';

const querySchema = z.object({
  channel: z.enum(['deposit', 'withdrawal']).optional(),
  currency: z.string().trim().toUpperCase().min(3).max(3).optional(),
  country: z.string().trim().toUpperCase().min(2).max(2).optional(),
});

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/user/payment-methods',
  summary: 'List payment methods for user',
  tags: ['User Payments'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Filtered payment methods' } },
});

router.get(
  '/payment-methods',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const query = querySchema.parse(req.query);
      const items = await listPaymentMethodsForUser({
        tenantId: scope.tenantId,
        currency: query.currency ?? null,
        country: query.country ?? null,
        channel: query.channel ?? null,
      });
      res.json({ items });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
