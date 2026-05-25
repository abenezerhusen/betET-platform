import { z } from 'zod';

const isoCurrency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const isoCountry = z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/);

const decimalAmount = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'must be a decimal with up to 2 dp');
const decimalAmountOrNull = decimalAmount.nullable();
const decimalPercent = z
  .string()
  .regex(/^\d+(\.\d{1,4})?$/, 'must be a decimal percent');

export const listPaymentMethodsQuerySchema = z.object({
  channel: z.enum(['deposit', 'withdrawal', 'transfer']).optional(),
  active_only: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  currency: isoCurrency.optional(),
  country: isoCountry.optional(),
});
export type ListPaymentMethodsQuery = z.infer<
  typeof listPaymentMethodsQuerySchema
>;

export const idParamSchema = z.object({ id: z.string().uuid() });

export const updatePaymentMethodSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    logo_url: z.string().trim().max(2048).nullable().optional(),
    min_amount: decimalAmountOrNull.optional(),
    max_amount: decimalAmountOrNull.optional(),
    fee_percent: decimalPercent.optional(),
    fee_fixed: decimalAmount.optional(),
    processing_time_hours: z.coerce.number().int().min(0).max(24 * 365).optional(),
    currencies: z.array(isoCurrency).min(1).optional(),
    countries: z.array(isoCountry).min(1).optional(),
    supports_deposit: z.boolean().optional(),
    supports_withdrawal: z.boolean().optional(),
    supports_transfer: z.boolean().optional(),
    is_default: z.boolean().optional(),
    is_active: z.boolean().optional(),
    display_order: z.coerce.number().int().min(0).max(10_000).optional(),
    config: z.record(z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'no fields to update',
  });
export type UpdatePaymentMethodInput = z.infer<
  typeof updatePaymentMethodSchema
>;

export const seedDefaultsSchema = z.object({
  /** When provided, seed for THIS tenant; otherwise the scope's tenant. */
  tenant_id: z.string().uuid().optional(),
});
export type SeedDefaultsInput = z.infer<typeof seedDefaultsSchema>;

/* -------------------------------------------------------------------------- */
/* Section 21 — create a brand-new payment method (Tab 3).                     */
/* -------------------------------------------------------------------------- */

export const createPaymentMethodSchema = z.object({
  provider_slug: z.string().trim().min(1).max(120),
  type: z.string().trim().min(1).max(60).optional().default('p2p'),
  name: z.string().trim().min(1).max(255),
  logo_url: z.string().trim().max(2048).nullable().optional(),
  min_amount: decimalAmountOrNull.optional(),
  max_amount: decimalAmountOrNull.optional(),
  fee_percent: decimalPercent.optional().default('0'),
  fee_fixed: decimalAmount.optional().default('0'),
  processing_time_hours: z.coerce.number().int().min(0).max(24 * 365).optional().default(24),
  currencies: z.array(isoCurrency).min(1).optional().default(['ETB']),
  countries: z.array(isoCountry).min(1).optional().default(['ET']),
  supports_deposit: z.boolean().optional().default(true),
  supports_withdrawal: z.boolean().optional().default(false),
  supports_transfer: z.boolean().optional().default(false),
  is_default: z.boolean().optional().default(false),
  is_active: z.boolean().optional().default(true),
  display_order: z.coerce.number().int().min(0).max(10_000).optional().default(0),
  config: z.record(z.unknown()).optional().default({}),
});
export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;

/**
 * Test-connection payload. Most providers can perform a no-op
 * credentials check with no extra parameters; some need an
 * override (e.g. dry-run amount). We accept an open record.
 */
export const testPaymentMethodSchema = z
  .object({
    overrides: z.record(z.unknown()).optional(),
  })
  .optional();
export type TestPaymentMethodInput = z.infer<typeof testPaymentMethodSchema>;
