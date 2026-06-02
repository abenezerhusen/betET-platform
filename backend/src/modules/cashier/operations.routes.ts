import { Router, type Request, type Response, type NextFunction } from 'express';
import { depositSchema, withdrawalSchema } from './cashier.dto';
import { processDeposit, processWithdrawal } from './operations.service';
import { requirePermission } from '../../middleware/require-permission';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/deposit',
  summary: 'Cashier wallet deposit',
  tags: ['Cashier'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string', format: 'uuid' },
            amount: { oneOf: [{ type: 'number' }, { type: 'string' }] },
            currency: { type: 'string', example: 'ETB' },
            idempotency_key: { type: 'string' },
            note: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '201': { description: 'Deposit processed' },
    '200': { description: 'Idempotent duplicate request returned' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/withdrawal',
  summary: 'Cashier wallet withdrawal',
  tags: ['Cashier'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            user_id: { type: 'string', format: 'uuid' },
            amount: { oneOf: [{ type: 'number' }, { type: 'string' }] },
            currency: { type: 'string', example: 'ETB' },
            idempotency_key: { type: 'string' },
            note: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '201': { description: 'Withdrawal processed' },
    '200': { description: 'Idempotent duplicate request returned' },
  },
});

router.post('/deposit', requirePermission('deposit'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = depositSchema.parse(req.body);
    const out = await processDeposit(req, body);
    res.status(out.idempotent ? 200 : 201).json(out);
  } catch (err) {
    next(err);
  }
});

router.post('/withdrawal', requirePermission('withdraw'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = withdrawalSchema.parse(req.body);
    const out = await processWithdrawal(req, body);
    res.status(out.idempotent ? 200 : 201).json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
