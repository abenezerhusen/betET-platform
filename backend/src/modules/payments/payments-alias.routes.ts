/**
 * Spec-aligned payments alias router.
 *
 *   GET  /api/payments/deposit/pending
 *   POST /api/payments/withdraw
 *
 * The user panel was specced against `/api/payments/*` while the actual
 * implementation lives under `/api/user/deposits/telebirr/*` and
 * `/api/user/withdrawals/telebirr/*`. We keep the existing routes intact
 * and forward through them here so the spec wording works without
 * duplicating service logic.
 *
 * Auth: end-user JWT (`user` or `affiliate`).
 */
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { z } from 'zod';

import { authenticateToken } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/require-role';
import * as depositService from '../user/deposits-telebirr.service';
import * as withdrawalService from '../user/withdrawals-telebirr.service';
import * as swagger from '../../swagger/registry';

const router = Router();

router.use(authenticateToken());
router.use(requireRole('user', 'affiliate'));

/* ----------------------------------------------------------------------- */
/* GET /api/payments/deposit/pending                                       */
/* ----------------------------------------------------------------------- */

swagger.registerPath({
  method: 'get',
  path: '/api/payments/deposit/pending',
  summary: 'Pending Telebirr deposit requests for the signed-in user',
  tags: ['Payments', 'User'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Pending deposit list' } },
});

router.get(
  '/deposit/pending',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Pull the most recent 20 requests and filter to pending statuses
      // client-side. The Telebirr deposit history endpoint doesn't take
      // a status filter today, so we do the cut here to keep the alias
      // self-contained.
      const history = await depositService.getDepositHistory(req, {
        page: 1,
        limit: 20,
      });
      const items = (history.items ?? []).filter(
        (r) => r.status === 'pending' || r.status === 'awaiting_admin'
      );
      res.json({ items });
    } catch (err) {
      next(err);
    }
  }
);

/* ----------------------------------------------------------------------- */
/* POST /api/payments/withdraw                                             */
/* ----------------------------------------------------------------------- */

/**
 * The spec body shape is `{ amount, phone }`. The real Telebirr endpoint
 * also needs an `account_name`. When the spec body comes in we fall back
 * to the customer's profile full name; if absent we use a generic
 * placeholder so the request still flows to the operator queue.
 */
const withdrawSchema = z
  .object({
    amount: z.union([z.string(), z.number()]),
    phone: z.string().trim().min(9).max(15).optional(),
    telebirr_number: z.string().trim().min(9).max(15).optional(),
    account_name: z.string().trim().min(2).max(255).optional(),
  })
  .refine((d) => Boolean(d.phone ?? d.telebirr_number), {
    message: 'phone is required',
    path: ['phone'],
  });

swagger.registerPath({
  method: 'post',
  path: '/api/payments/withdraw',
  summary:
    'Request a Telebirr withdrawal. Body: { amount, phone, account_name? }',
  tags: ['Payments', 'User'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            amount: { type: 'string' },
            phone: { type: 'string' },
            account_name: { type: 'string' },
          },
          required: ['amount', 'phone'],
        },
      },
    },
  },
  responses: { '201': { description: 'Withdrawal request created' } },
});

router.post(
  '/withdraw',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = withdrawSchema.parse(req.body);
      const amount =
        typeof body.amount === 'number'
          ? body.amount.toFixed(2)
          : String(body.amount);
      const phone = (body.phone ?? body.telebirr_number)!.trim();
      const accountName =
        body.account_name?.trim() ||
        // Reasonable fallback: use the phone as the receiver display name
        // so the queue row still has something to render. Operators can
        // edit it before payout if needed.
        phone;

      const out = await withdrawalService.initiate(req, {
        amount,
        telebirr_number: phone,
        account_name: accountName,
      });
      res.status(201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
