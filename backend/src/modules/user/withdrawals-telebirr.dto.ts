import { z } from 'zod';

const telebirrNumberSchema = z
  .string()
  .trim()
  .min(9)
  .max(15)
  .regex(/^[+0-9 -]+$/, 'invalid telebirr number');

const accountNameSchema = z.string().trim().min(2).max(255);

const amountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'amount must be a decimal with up to 2 dp')
  .refine((s) => Number(s) > 0, 'amount must be greater than 0');

export const initiateWithdrawalSchema = z.object({
  amount: amountSchema,
  telebirr_number: telebirrNumberSchema,
  account_name: accountNameSchema,
});
export type InitiateWithdrawalInput = z.infer<typeof initiateWithdrawalSchema>;

export const withdrawalIdParamSchema = z.object({
  requestId: z.string().uuid(),
});

export const withdrawalHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum([
      'pending',
      'processing',
      'completed',
      'rejected',
      'cancelled',
      'failed',
    ])
    .optional(),
});
export type WithdrawalHistoryQuery = z.infer<
  typeof withdrawalHistoryQuerySchema
>;
