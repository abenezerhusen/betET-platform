import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import {
  completeWithdrawalSchema,
  listPendingQuerySchema,
  rejectWithdrawalSchema,
  requestIdParamSchema,
} from './telebirr-withdrawals.dto';
import * as service from './telebirr-withdrawals.service';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/telebirr/withdrawals',
  summary: 'List pending Telebirr withdrawals',
  tags: ['Cashier Telebirr'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Pending withdrawal queue' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/telebirr/withdrawals/{requestId}/claim',
  summary: 'Claim Telebirr withdrawal',
  tags: ['Cashier Telebirr'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Withdrawal claimed' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/telebirr/withdrawals/{requestId}/complete',
  summary: 'Complete Telebirr withdrawal',
  tags: ['Cashier Telebirr'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            telebirr_ref: { type: 'string' },
            note: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Withdrawal completed' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/telebirr/withdrawals/{requestId}/reject',
  summary: 'Reject Telebirr withdrawal',
  tags: ['Cashier Telebirr'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Withdrawal rejected' },
  },
});

router.get(
  '/withdrawals',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listPendingQuerySchema.parse(req.query);
      const out = await service.listPending(req, query);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/withdrawals/:requestId/claim',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requestId } = requestIdParamSchema.parse(req.params);
      const out = await service.claim(req, requestId);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/withdrawals/:requestId/complete',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requestId } = requestIdParamSchema.parse(req.params);
      const body = completeWithdrawalSchema.parse(req.body);
      const out = await service.complete(req, requestId, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/withdrawals/:requestId/reject',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requestId } = requestIdParamSchema.parse(req.params);
      const body = rejectWithdrawalSchema.parse(req.body);
      const out = await service.reject(req, requestId, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
