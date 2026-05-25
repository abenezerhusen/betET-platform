import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import {
  initiateWithdrawalSchema,
  withdrawalHistoryQuerySchema,
  withdrawalIdParamSchema,
} from './withdrawals-telebirr.dto';
import * as service from './withdrawals-telebirr.service';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'post',
  path: '/api/user/withdrawals/telebirr/initiate',
  summary: 'Initiate Telebirr withdrawal',
  tags: ['User Payments'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '201': { description: 'Withdrawal request created' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/user/withdrawals/telebirr/history',
  summary: 'Telebirr withdrawal history',
  tags: ['User Payments'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Withdrawal history' } },
});

router.post(
  '/withdrawals/telebirr/initiate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = initiateWithdrawalSchema.parse(req.body);
      const out = await service.initiate(req, body);
      res.status(201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/withdrawals/telebirr/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = withdrawalHistoryQuerySchema.parse(req.query);
      const out = await service.history(req, query);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/withdrawals/telebirr/:requestId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requestId } = withdrawalIdParamSchema.parse(req.params);
      const out = await service.getStatus(req, requestId);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/withdrawals/telebirr/:requestId/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requestId } = withdrawalIdParamSchema.parse(req.params);
      const out = await service.cancel(req, requestId);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
