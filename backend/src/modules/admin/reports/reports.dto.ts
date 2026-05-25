import { z } from 'zod';

const dateInput = z.coerce.date();

const baseReportSchema = z.object({
  from: dateInput.optional(),
  to: dateInput.optional(),
  tenant_id: z.string().uuid().optional(),
  granularity: z.enum(['day', 'week', 'month']).default('day'),
});

export const revenueReportSchema = baseReportSchema;
export const betsReportSchema = baseReportSchema;
export const usersReportSchema = baseReportSchema;
export const transactionsReportSchema = baseReportSchema;

/* ------------------------------------------------------------------ */
/* Section 6 — cash & payable reports                                  */
/* ------------------------------------------------------------------ */

export const onlineCashReportSchema = z.object({
  from: dateInput.optional(),
  to: dateInput.optional(),
  tenant_id: z.string().uuid().optional(),
  sport: z.string().trim().min(1).max(100).optional(),
});

export const offlineCashReportSchema = z.object({
  from: dateInput.optional(),
  to: dateInput.optional(),
  tenant_id: z.string().uuid().optional(),
  branch_id: z.string().uuid().optional(),
  cashier_id: z.string().uuid().optional(),
});

export const PAYABLE_SCOPES = ['daily', 'agent', 'branch', 'sales'] as const;
export type PayableScope = (typeof PAYABLE_SCOPES)[number];

export const payableReportSchema = z.object({
  from: dateInput.optional(),
  to: dateInput.optional(),
  tenant_id: z.string().uuid().optional(),
  scope: z.enum(PAYABLE_SCOPES).default('daily'),
  status: z.enum(['pending', 'approved', 'rejected', 'paid']).optional(),
  entity_id: z.string().uuid().optional(),
});

export const payableActionSchema = z.object({
  notes: z.string().trim().max(1000).optional(),
});

export type RevenueReportQuery = z.infer<typeof revenueReportSchema>;
export type BetsReportQuery = z.infer<typeof betsReportSchema>;
export type UsersReportQuery = z.infer<typeof usersReportSchema>;
export type TransactionsReportQuery = z.infer<typeof transactionsReportSchema>;
export type OnlineCashReportQuery = z.infer<typeof onlineCashReportSchema>;
export type OfflineCashReportQuery = z.infer<typeof offlineCashReportSchema>;
export type PayableReportQuery = z.infer<typeof payableReportSchema>;
export type PayableActionInput = z.infer<typeof payableActionSchema>;

/** Resolve from/to with sensible defaults: last 30 days when omitted. */
export function resolveRange(input: { from?: Date; to?: Date }): {
  from: Date;
  to: Date;
} {
  const to = input.to ?? new Date();
  const from =
    input.from ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { from, to };
}
