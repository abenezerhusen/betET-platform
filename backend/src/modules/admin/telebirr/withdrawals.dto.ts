import { z } from 'zod';

export const listWithdrawalsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
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
  user_id: z.string().uuid().optional(),
  cashier_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(255).optional(),
});
export type ListWithdrawalsQuery = z.infer<typeof listWithdrawalsQuerySchema>;

export const withdrawalIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const adminCancelWithdrawalSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export type AdminCancelWithdrawalInput = z.infer<
  typeof adminCancelWithdrawalSchema
>;
