import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import * as service from './wallets.service';
import * as swagger from '../../../swagger/registry';
import {
  creditWalletSchema,
  debitWalletSchema,
  listWalletsSchema,
} from './wallets.dto';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/admin/wallets',
  summary: 'List wallets',
  tags: ['Admin Wallets'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Wallets list' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/wallets/{id}/credit',
  summary: 'Credit wallet',
  tags: ['Admin Wallets'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '200': { description: 'Wallet credited' } },
});

/**
 * POST /api/admin/wallets/ensure
 * Create a wallet for a user if it doesn't exist; returns the wallet.
 */
router.post('/ensure', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { user_id } = z.object({ user_id: z.string().uuid() }).parse(req.body);
    const wallet = await service.ensureWallet(req, user_id);
    res.json(wallet);
  } catch (err) {
    next(err);
  }
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = listWalletsSchema.parse(req.query);
    const out = await service.listWallets(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await service.getWallet(req, req.params.id);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/credit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = creditWalletSchema.parse(req.body);
      const out = await service.creditWallet(req, req.params.id, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/debit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = debitWalletSchema.parse(req.body);
      const out = await service.debitWallet(req, req.params.id, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
