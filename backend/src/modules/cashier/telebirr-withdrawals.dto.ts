import { z } from 'zod';

export const listPendingQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
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
  search: z.string().trim().max(255).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  /** When true, the cashier sees only requests they're holding. */
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListPendingQuery = z.infer<typeof listPendingQuerySchema>;

export const requestIdParamSchema = z.object({
  requestId: z.string().uuid(),
});

export const completeWithdrawalSchema = z.object({
  telebirr_ref: z.string().trim().min(4).max(64),
  notes: z.string().trim().max(2000).optional(),
});
export type CompleteWithdrawalInput = z.infer<typeof completeWithdrawalSchema>;

export const rejectWithdrawalSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export type RejectWithdrawalInput = z.infer<typeof rejectWithdrawalSchema>;
