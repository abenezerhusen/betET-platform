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

const ethiopianMobileSchema = z
  .string()
  .trim()
  .min(9)
  .max(15)
  .transform((raw) => normaliseEthiopianMobile(raw))
  .refine((s) => /^0\d{9}$/.test(s), {
    message: 'sender_telebirr_number must normalise to 0XXXXXXXXX',
  });

function normaliseEthiopianMobile(raw: string): string {
  const digits = raw.replace(/\D+/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  if (digits.length === 12 && digits.startsWith('251')) return `0${digits.slice(3)}`;
  if (digits.length === 9 && digits.startsWith('9')) return `0${digits}`;
  if (digits.length === 13 && digits.startsWith('2510')) return digits.slice(3);
  return digits;
}

export const submitDisputeSchema = z.object({
  amount: moneySchema,
  sender_telebirr_number: ethiopianMobileSchema,
  /** The Ref: code from the Telebirr SMS (when the user kept it). */
  claimed_telebirr_ref: z.string().trim().max(64).optional(),
  /** When the user sent the payment. */
  paid_at: z.coerce.date().optional(),
  /** URL of an uploaded screenshot — upload itself is out of scope here. */
  screenshot_url: z.string().trim().url().max(2048).optional(),
  description: z.string().trim().max(2000).optional(),
});
export type SubmitDisputeInput = z.infer<typeof submitDisputeSchema>;

export const listMyDisputesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: z
    .enum([
      'open',
      'investigating',
      'resolved_credited',
      'resolved_rejected',
      'cancelled',
    ])
    .optional(),
});
export type ListMyDisputesQuery = z.infer<typeof listMyDisputesQuerySchema>;

export const disputeIdParamSchema = z.object({
  id: z.string().uuid(),
});
