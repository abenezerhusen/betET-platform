import { z } from 'zod';

export const listDisputesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  status: z
    .enum([
      'open',
      'investigating',
      'resolved_credited',
      'resolved_rejected',
      'cancelled',
    ])
    .optional(),
  user_id: z.string().uuid().optional(),
  search: z.string().trim().max(255).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type ListDisputesQuery = z.infer<typeof listDisputesQuerySchema>;

export const investigateDisputeSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});
export type InvestigateDisputeInput = z.infer<typeof investigateDisputeSchema>;

export const resolveCreditSchema = z.object({
  /** id of the telebirr_transactions row that the admin determined
   *  belongs to this dispute. The dispute amount, sender_phone, and
   *  the transaction's matching attributes must agree (service
   *  enforces). */
  telebirr_transaction_id: z.string().uuid(),
  notes: z.string().trim().max(2000).optional(),
});
export type ResolveCreditInput = z.infer<typeof resolveCreditSchema>;

export const resolveRejectSchema = z.object({
  notes: z.string().trim().min(1).max(2000),
});
export type ResolveRejectInput = z.infer<typeof resolveRejectSchema>;

export const disputeIdParamSchema = z.object({
  id: z.string().uuid(),
});
