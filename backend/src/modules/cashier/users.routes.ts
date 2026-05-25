import { Router, type Request, type Response, type NextFunction } from 'express';
import {
  couponCodeParamSchema,
  userIdParamSchema,
  userSearchSchema,
  userWalletQuerySchema,
} from './cashier.dto';
import {
  getCouponDetails,
  getUserWallet,
  searchUsers,
  verifyUserId,
} from './users.service';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/users/search',
  summary: 'Search users for cashier operations',
  tags: ['Cashier'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '200': { description: 'Matching users' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/users/coupon/{code}',
  summary: 'Lookup coupon details',
  tags: ['Cashier'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Coupon details' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/users/{id}/wallet',
  summary: 'Get user wallet',
  tags: ['Cashier'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'User wallet summary' } },
});

router.post('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = userSearchSchema.parse(req.body);
    const out = await searchUsers(req, body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get(
  '/coupon/:code',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { code } = couponCodeParamSchema.parse(req.params);
      const out = await getCouponDetails(req, code);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id/wallet',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = userIdParamSchema.parse(req.params);
      const query = userWalletQuerySchema.parse(req.query);
      const out = await getUserWallet(req, id, query);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/verify-id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = userIdParamSchema.parse(req.params);
      const out = await verifyUserId(req, id);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
