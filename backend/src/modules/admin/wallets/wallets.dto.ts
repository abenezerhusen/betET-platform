import { z } from 'zod';

const amountSchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .refine((s) => /^\d{1,16}(\.\d{1,4})?$/.test(s), {
    message: 'Amount must be a positive number with up to 4 decimal places',
  })
  .refine((s) => Number(s) > 0, {
    message: 'Amount must be greater than zero',
  });

export const listWalletsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  user_id: z.string().uuid().optional(),
  currency: z.string().trim().min(2).max(8).optional(),
  status: z.enum(['active', 'frozen', 'closed']).optional(),
  min_balance: z.coerce.number().nonnegative().optional(),
  max_balance: z.coerce.number().nonnegative().optional(),
});

export const walletBucketSchema = z.enum(['deductable', 'withdrawable', 'payable']);

export const creditWalletSchema = z.object({
  amount: amountSchema,
  reason: z.string().trim().min(1).max(1000),
  reference: z.string().trim().max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
  bucket: walletBucketSchema.default('deductable'),
});

export const debitWalletSchema = creditWalletSchema;

export type ListWalletsQuery = z.infer<typeof listWalletsSchema>;
export type CreditWalletInput = z.infer<typeof creditWalletSchema>;
export type DebitWalletInput = z.infer<typeof debitWalletSchema>;
export type WalletBucket = z.infer<typeof walletBucketSchema>;
