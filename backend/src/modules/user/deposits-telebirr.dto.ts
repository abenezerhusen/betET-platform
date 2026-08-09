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
   * Telebirr SMS (the `transaction number` value). Optional: when supplied the
   * backend confirms the deposit by matching it against the agent SMS's parsed
   * ref.
   *
   * A live Telebirr transaction number is ALWAYS a 10-character alphanumeric
   * code (e.g. "DGD2T2M9YQ"). We reject anything else up-front so a mistyped /
   * wrong reference is flagged immediately as "Invalid Reference Number"
   * instead of opening a deposit request that can only ever sit in "Waiting".
   * The value is upper-cased to match the SMS-parsed ref (Strategy 0).
   */
  telebirr_reference: z
    .string()
    .trim()
    .transform((s) => s.toUpperCase())
    .refine((s) => /^[A-Z0-9]{10}$/.test(s), {
      message:
        'Invalid Reference Number. The 10-digit Telebirr reference you entered is incorrect — open your Telebirr SMS, check the transaction number carefully, and enter it again.',
    })
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
