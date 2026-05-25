import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import {
  listTransactionsQuerySchema,
  listUnmatchedQuerySchema,
  matchTransactionSchema,
  transactionIdParamSchema,
  voidTransactionSchema,
} from './telebirr.dto';
import * as service from './telebirr.service';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/telebirr/unmatched',
  summary: 'List unmatched Telebirr transactions',
  tags: ['Cashier Telebirr'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Unmatched transactions' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/telebirr/match/{transactionId}',
  summary: 'Match Telebirr transaction to user',
  tags: ['Cashier Telebirr'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '200': { description: 'Match result' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/telebirr/void/{transactionId}',
  summary: 'Void Telebirr transaction',
  tags: ['Cashier Telebirr'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '200': { description: 'Void result' } },
});

router.get(
  '/unmatched',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listUnmatchedQuerySchema.parse(req.query);
      const out = await service.listUnmatched(req, query);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/transactions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listTransactionsQuerySchema.parse(req.query);
      const out = await service.listTransactions(req, query);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/match/:transactionId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transactionId } = transactionIdParamSchema.parse(req.params);
      const body = matchTransactionSchema.parse(req.body);
      const out = await service.matchTransaction(req, transactionId, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/void/:transactionId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { transactionId } = transactionIdParamSchema.parse(req.params);
      const body = voidTransactionSchema.parse(req.body);
      const out = await service.voidTransaction(req, transactionId, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
