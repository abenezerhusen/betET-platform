import { z } from 'zod';

const moneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .refine((s) => /^\d{1,16}(\.\d{1,2})?$/.test(s), {
    message: 'Amount must be a positive number with up to 2 decimal places',
  })
  .refine((s) => Number(s) > 0, {
    message: 'Amount must be greater than zero',
  });

export const initiateDepositSchema = z.object({
  amount: moneySchema,
});
export type InitiateDepositInput = z.infer<typeof initiateDepositSchema>;

export const depositRequestIdParamSchema = z.object({
  requestId: z.string().uuid(),
});

export const depositHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type DepositHistoryQuery = z.infer<typeof depositHistoryQuerySchema>;
