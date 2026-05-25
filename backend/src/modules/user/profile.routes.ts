import { Router, type Request, type Response, type NextFunction } from 'express';
import * as swagger from '../../swagger/registry';
import {
  betsHistorySchema,
  changePasswordSchema,
  transactionsHistorySchema,
  updateProfileSchema,
} from './user.dto';
import {
  changePassword,
  getMe,
  listMyBets,
  listMyTransactions,
  updateMe,
} from './profile.service';

const router = Router();

swagger.registerPath({
  method: 'put',
  path: '/api/user/me',
  summary: 'Update user profile',
  tags: ['User Profile'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Profile updated' },
    '400': { description: 'Validation error' },
  },
});

router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await getMe(req);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.put('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateProfileSchema.parse(req.body);
    const out = await updateMe(req, body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/me/change-password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = changePasswordSchema.parse(req.body);
      const out = await changePassword(req, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/me/transactions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = transactionsHistorySchema.parse(req.query);
      const out = await listMyTransactions(req, params);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/me/bets',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = betsHistorySchema.parse(req.query);
      const out = await listMyBets(req, params);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
