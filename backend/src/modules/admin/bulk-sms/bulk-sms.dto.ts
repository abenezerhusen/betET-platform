/**
 * Zod schemas for the Bulk SMS marketing module.
 *
 * Kept in one place so routes stay thin and the service layer receives fully
 * validated, typed inputs.
 */

import { z } from 'zod';

/* -------------------------------------------------------------------------- */
/*  Gateway settings                                                          */
/* -------------------------------------------------------------------------- */
export const gatewaySettingsSchema = z.object({
  enabled: z.boolean().optional(),
  gateway_name: z.string().trim().min(1).max(80).optional(),
  api_url: z.string().trim().url().max(300).optional(),
  /**
   * Plaintext API key from the form. Sealed before storage and never echoed
   * back. Empty string / omitted = keep the existing key untouched.
   */
  api_key: z.string().trim().max(400).optional(),
  device_id: z.string().trim().max(200).optional(),
  sender_number: z.string().trim().max(40).optional(),
  default_country_code: z
    .string()
    .trim()
    .regex(/^\+?\d{1,4}$/, 'Country code must look like +251')
    .max(6)
    .optional(),
  max_sms_per_day: z.coerce.number().int().min(0).max(1_000_000).optional(),
  delay_ms: z.coerce.number().int().min(0).max(60_000).optional(),
});

export const testSmsSchema = z.object({
  phone: z.string().trim().min(3).max(40),
  message: z.string().trim().min(1).max(1000).optional(),
});

/* -------------------------------------------------------------------------- */
/*  Templates                                                                 */
/* -------------------------------------------------------------------------- */
export const templateCreateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(1600),
});

export const templateUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  body: z.string().trim().min(1).max(1600).optional(),
});

/* -------------------------------------------------------------------------- */
/*  Campaigns                                                                 */
/* -------------------------------------------------------------------------- */
const recipientSchema = z.object({
  phone: z.string().trim().min(3).max(40),
  /** Optional per-recipient variables for {name}, {username}, … substitution. */
  vars: z.record(z.string(), z.string()).optional(),
});

export const campaignCreateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  template_id: z.string().uuid().optional(),
  /** Message body with optional {variable} placeholders. */
  message: z.string().trim().min(1).max(1600),
  /**
   * Recipient list — already validated / de-duplicated / country-code-applied
   * on the client (Excel import), re-validated + normalized here server-side.
   */
  recipients: z.array(recipientSchema).min(1).max(100_000),
  /** When false the campaign is created as a draft (not queued for sending). */
  start: z.boolean().default(true),
});

/* -------------------------------------------------------------------------- */
/*  Shared list queries                                                       */
/* -------------------------------------------------------------------------- */
export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(20),
  status: z.string().trim().max(40).optional(),
  search: z.string().trim().max(120).optional(),
  campaign_id: z.string().uuid().optional(),
});

export const idParamSchema = z.object({ id: z.string().uuid() });

export type GatewaySettingsInput = z.infer<typeof gatewaySettingsSchema>;
export type TestSmsInput = z.infer<typeof testSmsSchema>;
export type TemplateCreateInput = z.infer<typeof templateCreateSchema>;
export type TemplateUpdateInput = z.infer<typeof templateUpdateSchema>;
export type CampaignCreateInput = z.infer<typeof campaignCreateSchema>;
export type ListQuery = z.infer<typeof listQuerySchema>;
