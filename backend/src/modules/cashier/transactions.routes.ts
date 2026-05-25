import { Router, type Request, type Response, type NextFunction } from 'express';
import { cashierTransactionsSchema, ticketIdParamSchema } from './cashier.dto';
import { getReceipt, listOwnTransactions } from './transactions.service';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/transactions',
  summary: 'List cashier transactions',
  tags: ['Cashier'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Transactions list' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/transactions/{id}/receipt',
  summary: 'Get printable transaction receipt',
  tags: ['Cashier'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Receipt payload' } },
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = cashierTransactionsSchema.parse(req.query);
    const out = await listOwnTransactions(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get(
  '/:id/receipt',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = ticketIdParamSchema.parse(req.params);
      const out = await getReceipt(req, id);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
