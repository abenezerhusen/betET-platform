import { z } from 'zod';

/** Query for the config endpoint (which methods + phone-edit flag). */
export const gatewayConfigQuerySchema = z.object({
  channel: z.enum(['deposit', 'withdrawal']).optional(),
});

/** Body for initiating a deposit or withdrawal via a gateway method. */
export const gatewayInitiateSchema = z.object({
  provider_slug: z.string().trim().min(1).max(64),
  amount: z.union([z.number(), z.string()]),
  /** Optional; only honoured when the admin enabled phone editing. */
  phone: z.string().trim().min(4).max(32).optional(),
});

export const gatewayHistoryQuerySchema = z.object({
  direction: z.enum(['deposit', 'withdrawal']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export type GatewayConfigQuery = z.infer<typeof gatewayConfigQuerySchema>;
export type GatewayInitiateInput = z.infer<typeof gatewayInitiateSchema>;
export type GatewayHistoryQuery = z.infer<typeof gatewayHistoryQuerySchema>;
