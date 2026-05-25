import { z } from 'zod';

export const matchTransactionSchema = z.object({
  user_id: z.string().uuid(),
  /**
   * Optional cashier PIN. The backend currently has no PIN concept, so
   * we accept the field for forward compatibility but do not verify it.
   * Matched against `users.metadata->>'pin_hash'` once that column lands.
   */
  pin: z.string().min(4).max(32).optional(),
});
export type MatchTransactionInput = z.infer<typeof matchTransactionSchema>;

export const voidTransactionSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  pin: z.string().min(4).max(32).optional(),
  /**
   * Set to true when an admin has approved the void above the
   * configured threshold. The backend currently treats this as an
   * informational flag; tighten when the admin approval workflow ships.
   */
  admin_approval_token: z.string().min(1).max(256).optional(),
});
export type VoidTransactionInput = z.infer<typeof voidTransactionSchema>;

export const transactionIdParamSchema = z.object({
  transactionId: z.string().uuid(),
});

export const listTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  status: z
    .enum([
      'pending',
      'matched',
      'credited',
      'duplicate',
      'unmatched',
      'disputed',
    ])
    .optional(),
  agent_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(255).optional(),
});
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

export const listUnmatchedQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  agent_id: z.string().uuid().optional(),
  search: z.string().trim().max(255).optional(),
});
export type ListUnmatchedQuery = z.infer<typeof listUnmatchedQuerySchema>;
