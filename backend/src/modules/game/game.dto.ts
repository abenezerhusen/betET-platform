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

const optionalCurrency = z.string().trim().min(2).max(8).optional();

/* ------------------------------------------------------------------------- */
/* Outbound: launch a game session                                           */
/* ------------------------------------------------------------------------- */

export const createSessionSchema = z.object({
  game_id: z.string().uuid(),
  currency: optionalCurrency,
  return_url: z.string().url().max(2048).optional(),
  language: z.string().trim().max(10).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const sessionIdParamSchema = z.object({
  id: z.string().uuid(),
});

/* ------------------------------------------------------------------------- */
/* Inbound: provider webhooks                                                */
/* ------------------------------------------------------------------------- */

const webhookCommonSchema = z.object({
  session_id: z.string().uuid(),
  request_id: z.string().trim().min(1).max(255),
});

export const balanceWebhookSchema = webhookCommonSchema;

export const debitWebhookSchema = webhookCommonSchema.extend({
  transaction_id: z.string().trim().min(1).max(255),
  amount: moneySchema,
  currency: optionalCurrency,
  round_id: z.string().trim().max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const creditWebhookSchema = webhookCommonSchema.extend({
  transaction_id: z.string().trim().min(1).max(255),
  amount: moneySchema,
  currency: optionalCurrency,
  round_id: z.string().trim().max(255).optional(),
  // Optional link to the original debit transaction id (provider-side).
  reference_transaction_id: z.string().trim().max(255).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const rollbackWebhookSchema = webhookCommonSchema.extend({
  transaction_id: z.string().trim().min(1).max(255),
  // The provider-side id of the debit being reversed (required).
  reference_transaction_id: z.string().trim().min(1).max(255),
  currency: optionalCurrency,
  metadata: z.record(z.unknown()).optional(),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type BalanceWebhookInput = z.infer<typeof balanceWebhookSchema>;
export type DebitWebhookInput = z.infer<typeof debitWebhookSchema>;
export type CreditWebhookInput = z.infer<typeof creditWebhookSchema>;
export type RollbackWebhookInput = z.infer<typeof rollbackWebhookSchema>;
