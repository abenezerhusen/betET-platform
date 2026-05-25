import { z } from 'zod';

const moneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .refine((s) => /^\d{1,16}(\.\d{1,4})?$/.test(s), {
    message: 'Amount must be a positive number with up to 4 decimal places',
  })
  .refine((s) => Number(s) > 0, {
    message: 'Amount must be greater than zero',
  });

const idempotencyKeyBodySchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9._:\-]+$/, 'invalid idempotency key')
  .optional();

/* ------------------------------------------------------------------------- */
/* Operations: deposit / withdrawal                                          */
/* ------------------------------------------------------------------------- */

/**
 * Section 16 accepts `{ phone, amount, branch_id }` in addition to the
 * existing `{ user_id, amount, … }` payload. We resolve `phone` (or the
 * `email` shortcut) to a `user_id` at the service layer when only the
 * spec-shape comes in, so the legacy callers still work.
 */
export const depositSchema = z
  .object({
    user_id: z.string().uuid().optional(),
    /** Spec-aligned alternative identifier for walk-in deposits. */
    phone: z.string().trim().min(6).max(32).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    branch_id: z.string().trim().min(2).max(128).optional(),
    amount: moneySchema,
    currency: z.string().trim().min(2).max(8).optional(),
    payment_method: z
      .enum(['cash', 'card', 'bank_transfer', 'mobile_money', 'voucher', 'other'])
      .default('cash'),
    reference: z.string().trim().max(255).optional(),
    notes: z.string().trim().max(1000).optional(),
    idempotency_key: idempotencyKeyBodySchema,
  })
  .refine((d) => Boolean(d.user_id || d.phone || d.email), {
    message: 'One of user_id, phone, or email is required',
    path: ['user_id'],
  });

export const withdrawalSchema = depositSchema;

/* ------------------------------------------------------------------------- */
/* Users                                                                     */
/* ------------------------------------------------------------------------- */

export const userSearchSchema = z
  .object({
    query: z.string().trim().min(1).max(255).optional(),
    phone: z.string().trim().min(3).max(32).optional(),
    email: z.string().trim().toLowerCase().email().optional(),
    user_id: z.string().uuid().optional(),
    limit: z.coerce.number().int().positive().max(50).default(20),
  })
  .refine(
    (d) => Boolean(d.query || d.phone || d.email || d.user_id),
    { message: 'Provide at least one of query, phone, email, or user_id' }
  );

export const userIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const couponCodeParamSchema = z.object({
  code: z.string().trim().min(1).max(128),
});

export const ticketIdParamSchema = z.object({
  id: z.string().trim().min(1).max(128),
});

export const userWalletQuerySchema = z.object({
  currency: z.string().trim().min(2).max(8).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
});

/* ------------------------------------------------------------------------- */
/* Shifts                                                                    */
/* ------------------------------------------------------------------------- */

export const openShiftSchema = z.object({
  opening_balance: moneySchema.or(z.literal('0')),
  branch_id: z.string().uuid().optional(),
  currency: z.string().trim().min(2).max(8).optional(),
  notes: z.string().trim().max(1000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const closeShiftSchema = z.object({
  closing_balance: moneySchema.or(z.literal('0')),
  notes: z.string().trim().max(1000).optional(),
});

/* ------------------------------------------------------------------------- */
/* Transactions history                                                      */
/* ------------------------------------------------------------------------- */

export const cashierTransactionsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  type: z.enum(['deposit', 'withdrawal']).optional(),
  status: z
    .enum(['pending', 'approved', 'rejected', 'completed', 'cancelled', 'failed'])
    .optional(),
  shift_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type DepositInput = z.infer<typeof depositSchema>;
export type WithdrawalInput = z.infer<typeof withdrawalSchema>;
export type UserSearchInput = z.infer<typeof userSearchSchema>;
export type UserWalletQuery = z.infer<typeof userWalletQuerySchema>;
export type OpenShiftInput = z.infer<typeof openShiftSchema>;
export type CloseShiftInput = z.infer<typeof closeShiftSchema>;
export type CashierTransactionsQuery = z.infer<typeof cashierTransactionsSchema>;
