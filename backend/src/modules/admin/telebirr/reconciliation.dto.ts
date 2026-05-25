import { z } from 'zod';

export const listReconciliationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  agent_id: z.string().uuid().optional(),
  status: z.enum(['open', 'matched', 'flagged', 'resolved']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListReconciliationQuery = z.infer<
  typeof listReconciliationQuerySchema
>;

export const runReconciliationSchema = z.object({
  /** Day to reconcile (YYYY-MM-DD or ISO). Defaults to yesterday UTC. */
  day: z.coerce.date().optional(),
  /** Force a recompute even for already-resolved rows. */
  rebuild: z.boolean().optional(),
});
export type RunReconciliationInput = z.infer<typeof runReconciliationSchema>;

export const attachStatementSchema = z.object({
  agent_id: z.string().uuid(),
  day: z.coerce.date(),
  reported_total: z
    .union([z.string(), z.number()])
    .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
    .refine((s) => /^\d{1,16}(\.\d{1,2})?$/.test(s), {
      message: 'reported_total must be a non-negative number',
    }),
  reported_count: z.coerce.number().int().nonnegative().optional(),
  statement_url: z.string().trim().url().max(2048).optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type AttachStatementInput = z.infer<typeof attachStatementSchema>;

export const reconciliationIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const resolveReconciliationSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});
export type ResolveReconciliationInput = z.infer<
  typeof resolveReconciliationSchema
>;
