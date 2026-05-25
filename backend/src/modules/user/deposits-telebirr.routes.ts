import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import {
  depositHistoryQuerySchema,
  depositRequestIdParamSchema,
  initiateDepositSchema,
} from './deposits-telebirr.dto';
import * as service from './deposits-telebirr.service';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'post',
  path: '/api/user/deposits/telebirr/initiate',
  summary: 'Initiate Telebirr deposit',
  tags: ['User Payments'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '201': { description: 'Deposit request created' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/user/deposits/telebirr/history',
  summary: 'Telebirr deposit history',
  tags: ['User Payments'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Deposit history' } },
});

router.post(
  '/deposits/telebirr/initiate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = initiateDepositSchema.parse(req.body);
      const out = await service.initiateDeposit(req, body);
      res.status(201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/deposits/telebirr/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = depositHistoryQuerySchema.parse(req.query);
      const out = await service.getDepositHistory(req, query);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/deposits/telebirr/:requestId/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requestId } = depositRequestIdParamSchema.parse(req.params);
      const out = await service.getDepositStatus(req, requestId);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/deposits/telebirr/:requestId/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { requestId } = depositRequestIdParamSchema.parse(req.params);
      const out = await service.cancelDeposit(req, requestId);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
