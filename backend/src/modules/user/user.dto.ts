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
/* Profile                                                                   */
/* ------------------------------------------------------------------------- */

export const updateProfileSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().min(3).max(32).optional(),
    metadata: z
      .object({
        first_name: z.string().trim().max(100).optional(),
        last_name: z.string().trim().max(100).optional(),
        date_of_birth: z.coerce.date().optional(),
        gender: z.enum(['male', 'female', 'other', 'prefer_not_to_say']).optional(),
        country: z.string().trim().max(2).optional(),
        city: z.string().trim().max(100).optional(),
        address: z.string().trim().max(500).optional(),
        language: z.string().trim().max(10).optional(),
        timezone: z.string().trim().max(64).optional(),
        marketing_opt_in: z.boolean().optional(),
      })
      .partial()
      .optional(),
  })
  .refine(
    (d) =>
      d.email !== undefined ||
      d.phone !== undefined ||
      (d.metadata && Object.keys(d.metadata).length > 0),
    { message: 'no fields to update' }
  );

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1).max(128),
    new_password: z.string().min(8).max(128),
  })
  .refine((d) => d.current_password !== d.new_password, {
    message: 'new_password must differ from current_password',
    path: ['new_password'],
  });

export const transactionsHistorySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  type: z.string().trim().max(50).optional(),
  status: z.enum(['pending', 'completed', 'failed', 'reversed', 'cancelled']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const betsHistorySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: z
    .enum([
      'pending',
      'accepted',
      'won',
      'lost',
      'void',
      'cancelled',
      'cashed_out',
      'partial_won',
    ])
    .optional(),
  game_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/* ------------------------------------------------------------------------- */
/* Wallet                                                                    */
/* ------------------------------------------------------------------------- */

export const walletQuerySchema = z.object({
  currency: z.string().trim().min(2).max(8).optional(),
});

export const withdrawalRequestSchema = z.object({
  amount: moneySchema,
  currency: z.string().trim().min(2).max(8).optional(),
  payment_method: z
    .enum(['cash', 'card', 'bank_transfer', 'mobile_money', 'voucher', 'other'])
    .default('bank_transfer'),
  payment_details: z.record(z.unknown()).optional(),
  notes: z.string().trim().max(1000).optional(),
  idempotency_key: idempotencyKeyBodySchema,
});

/**
 * Peer-to-peer wallet transfer between two end-users in the same tenant.
 * Identifies the receiver by phone (preferred) OR email — but not both.
 */
export const walletTransferSchema = z
  .object({
    amount: moneySchema,
    currency: z.string().trim().min(2).max(8).optional(),
    receiver_phone: z.string().trim().min(3).max(32).optional(),
    receiver_email: z.string().trim().toLowerCase().email().optional(),
    receiver_user_id: z.string().uuid().optional(),
    note: z.string().trim().max(255).optional(),
    idempotency_key: idempotencyKeyBodySchema,
  })
  .refine(
    (d) =>
      Boolean(d.receiver_phone) ||
      Boolean(d.receiver_email) ||
      Boolean(d.receiver_user_id),
    {
      message: 'receiver_phone, receiver_email or receiver_user_id is required',
      path: ['receiver_phone'],
    }
  );

export type WalletTransferInput = z.infer<typeof walletTransferSchema>;

/* ------------------------------------------------------------------------- */
/* Games                                                                     */
/* ------------------------------------------------------------------------- */

export const listGamesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  type: z
    .enum([
      'sports',
      'casino',
      'live_casino',
      'virtual',
      'crash',
      'keno',
      'slot',
      'table',
      'jackpot',
      'custom',
    ])
    .optional(),
  provider: z.string().trim().max(255).optional(),
  search: z.string().trim().max(255).optional(),
});

/* ------------------------------------------------------------------------- */
/* Bets                                                                      */
/* ------------------------------------------------------------------------- */

export const placeBetSchema = z.object({
  game_id: z.string().uuid(),
  session_id: z.string().uuid().optional(),
  stake: moneySchema,
  potential_win: moneySchema.optional(),
  currency: z.string().trim().min(2).max(8).optional(),
  selection: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  idempotency_key: idempotencyKeyBodySchema,
});

export const betIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const couponCodeParamSchema = z.object({
  code: z.string().trim().min(1).max(128),
});

/* ------------------------------------------------------------------------- */
/* Bonuses                                                                   */
/* ------------------------------------------------------------------------- */

export const listBonusesQuerySchema = z.object({
  status: z.enum(['available', 'active', 'all']).default('all'),
});

export const claimBonusSchema = z
  .object({
    metadata: z.record(z.unknown()).optional(),
  })
  .optional()
  .default({});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type TransactionsHistoryQuery = z.infer<typeof transactionsHistorySchema>;
export type BetsHistoryQuery = z.infer<typeof betsHistorySchema>;
export type WalletQuery = z.infer<typeof walletQuerySchema>;
export type WithdrawalRequestInput = z.infer<typeof withdrawalRequestSchema>;
export type ListGamesQuery = z.infer<typeof listGamesSchema>;
export type PlaceBetInput = z.infer<typeof placeBetSchema>;
export type CouponCodeParam = z.infer<typeof couponCodeParamSchema>;
export type ListBonusesQuery = z.infer<typeof listBonusesQuerySchema>;
export type ClaimBonusInput = z.infer<typeof claimBonusSchema>;
