import { z } from 'zod';

const moneySchema = z
  .union([z.string(), z.number()])
  .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
  .refine((s) => /^\d{1,16}(\.\d{1,2})?$/.test(s), {
    message: 'Amount must be a positive number with up to 2 decimal places',
  })
  .refine((s) => Number(s) > 0, {
    message: 'Amount must be greater than zero',
  });

export const initiateDepositSchema = z.object({
  amount: moneySchema,
  /**
   * Real Telebirr transaction reference the user pasted from their own
   * Telebirr SMS (the `Ref:` value). Optional: when supplied the backend
   * confirms the deposit by matching it against the agent SMS's parsed ref.
   * Telebirr refs are short alphanumeric strings; keep it lenient but bounded.
   */
  telebirr_reference: z
    .string()
    .trim()
    .min(4)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/, 'Invalid Telebirr reference')
    .optional(),
  /**
   * Payment screenshot as a base64 data URL (image/*) or an http(s) URL.
   * Stored as evidence for verification. Bounded to stay well under the
   * 25mb JSON body limit.
   */
  screenshot_url: z
    .string()
    .trim()
    .max(15_000_000)
    .refine(
      (v) => /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(v) || /^https?:\/\//.test(v),
      'Screenshot must be an image data URL or http(s) URL'
    )
    .optional(),
});
export type InitiateDepositInput = z.infer<typeof initiateDepositSchema>;

export const depositRequestIdParamSchema = z.object({
  requestId: z.string().uuid(),
});

export const depositHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});
export type DepositHistoryQuery = z.infer<typeof depositHistoryQuerySchema>;
