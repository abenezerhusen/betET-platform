import { Router, type Request, type Response, type NextFunction } from 'express';
import * as swagger from '../../swagger/registry';
import {
  walletQuerySchema,
  walletTransferSchema,
  withdrawalRequestSchema,
} from './user.dto';
import {
  getMyWallet,
  submitWithdrawalRequest,
  transferWalletFunds,
} from './wallet.service';

const router = Router();

swagger.registerPath({
  method: 'post',
  path: '/api/user/withdrawal/request',
  summary: 'Submit withdrawal request',
  tags: ['User Wallet'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['amount'],
          properties: {
            amount: { oneOf: [{ type: 'string' }, { type: 'number' }] },
            currency: { type: 'string', example: 'ETB' },
            payment_method: { type: 'string', example: 'mobile_money' },
            payment_details: { type: 'object', additionalProperties: true },
            notes: { type: 'string' },
            idempotency_key: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '201': { description: 'Withdrawal request created' },
    '200': { description: 'Idempotent duplicate request returned' },
    '400': { description: 'Validation / business error' },
  },
});

router.get('/wallet', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = walletQuerySchema.parse(req.query);
    const out = await getMyWallet(req, query);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/withdrawal/request',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = withdrawalRequestSchema.parse(req.body);
      const out = await submitWithdrawalRequest(req, body);
      res.status(out.idempotent ? 200 : 201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/wallet/transfer',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = walletTransferSchema.parse(req.body);
      const out = await transferWalletFunds(req, body);
      res.status(out.idempotent ? 200 : 201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
