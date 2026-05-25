import { z } from 'zod';

/** Telebirr numbers we accept on input. We store the canonical 10-digit
 *  form (0XXXXXXXXX) to match how the SMS parser normalises agent and
 *  sender phones. Any of `0911...`, `+251911...`, `251911...`, or
 *  `911...` is converted at the DTO layer. */
const telebirrNumberSchema = z
  .string()
  .trim()
  .min(9)
  .max(15)
  .transform((raw) => normaliseEthiopianMobile(raw))
  .refine((s) => /^0\d{9}$/.test(s), {
    message: 'telebirr_number must normalise to 0XXXXXXXXX (Ethiopian mobile)',
  });

function normaliseEthiopianMobile(raw: string): string {
  const digits = raw.replace(/\D+/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return digits;
  if (digits.length === 12 && digits.startsWith('251')) {
    return `0${digits.slice(3)}`;
  }
  if (digits.length === 9 && digits.startsWith('9')) {
    return `0${digits}`;
  }
  if (digits.length === 13 && digits.startsWith('2510')) {
    return digits.slice(3);
  }
  return digits; // let the regex refine() reject the malformed shape
}

/* ------------------------------------------------------------------------- */
/* Agents                                                                    */
/* ------------------------------------------------------------------------- */

export const listAgentsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  status: z.enum(['active', 'inactive', 'suspended']).optional(),
  search: z.string().trim().max(255).optional(),
});
export type ListAgentsQuery = z.infer<typeof listAgentsQuerySchema>;

export const createAgentSchema = z.object({
  agent_name: z.string().trim().min(1).max(255),
  telebirr_number: telebirrNumberSchema,
  device_id: z.string().trim().min(1).max(255),
  device_name: z.string().trim().max(255).optional(),
  password: z.string().min(8).max(128),
  assigned_cashier_id: z.string().uuid().optional(),
});
export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const updateAgentSchema = z
  .object({
    agent_name: z.string().trim().min(1).max(255).optional(),
    telebirr_number: telebirrNumberSchema.optional(),
    device_name: z.string().trim().max(255).optional(),
    assigned_cashier_id: z.string().uuid().nullable().optional(),
    /** Optional password rotation. */
    password: z.string().min(8).max(128).optional(),
  })
  .refine(
    (d) =>
      d.agent_name !== undefined ||
      d.telebirr_number !== undefined ||
      d.device_name !== undefined ||
      d.assigned_cashier_id !== undefined ||
      d.password !== undefined,
    { message: 'no fields to update' }
  );
export type UpdateAgentInput = z.infer<typeof updateAgentSchema>;

export const toggleAgentSchema = z.object({
  status: z.enum(['active', 'inactive', 'suspended']),
  reason: z.string().trim().max(500).optional(),
});
export type ToggleAgentInput = z.infer<typeof toggleAgentSchema>;

export const agentIdParamSchema = z.object({
  id: z.string().uuid(),
});

/* ------------------------------------------------------------------------- */
/* Transactions                                                              */
/* ------------------------------------------------------------------------- */

export const listAdminTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  status: z
    .enum([
      'pending',
      'matched',
      'credited',
      'duplicate',
      'unmatched',
      'disputed',
    ])
    .optional(),
  agent_id: z.string().uuid().optional(),
  user_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(255).optional(),
});
export type ListAdminTransactionsQuery = z.infer<
  typeof listAdminTransactionsQuerySchema
>;

export const transactionIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const disputeTransactionSchema = z.object({
  reason: z.string().trim().min(1).max(2000),
});
export type DisputeTransactionInput = z.infer<typeof disputeTransactionSchema>;

/* ------------------------------------------------------------------------- */
/* Raw SMS                                                                   */
/* ------------------------------------------------------------------------- */

export const listRawSmsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  agent_id: z.string().uuid().optional(),
  processed: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(255).optional(),
});
export type ListRawSmsQuery = z.infer<typeof listRawSmsQuerySchema>;

/* ------------------------------------------------------------------------- */
/* Reports                                                                   */
/* ------------------------------------------------------------------------- */

export const reportsQuerySchema = z
  .object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    granularity: z.enum(['hour', 'day', 'week']).default('day'),
  })
  .refine((d) => !d.from || !d.to || d.from < d.to, {
    message: 'from must be < to',
    path: ['from'],
  });
export type ReportsQuery = z.infer<typeof reportsQuerySchema>;

/* ------------------------------------------------------------------------- */
/* Settings                                                                  */
/* ------------------------------------------------------------------------- */

export const updateTelebirrSettingsSchema = z
  .object({
    min_deposit: z.coerce.number().nonnegative().optional(),
    max_deposit: z.coerce.number().nonnegative().optional(),
    expiry_minutes: z.coerce.number().int().min(1).max(120).optional(),
    reference_code_prefix: z
      .string()
      .trim()
      .max(4)
      .regex(/^[A-Z0-9]*$/, {
        message: 'prefix must be uppercase letters/digits only',
      })
      .optional(),
    reference_code_length: z.coerce.number().int().min(3).max(6).optional(),
    auto_approve_threshold: z.coerce.number().nonnegative().optional(),
    void_admin_approval_threshold: z.coerce
      .number()
      .nonnegative()
      .optional(),
    /* Provider toggles */
    p2p_enabled: z.boolean().optional(),
    withdrawal_enabled: z.boolean().optional(),
    /* Fraud-prevention thresholds */
    sms_timestamp_skew_minutes: z.coerce.number().int().min(1).max(120).optional(),
    max_single_sms_amount: z.coerce.number().nonnegative().optional(),
    max_daily_agent_volume: z.coerce.number().nonnegative().optional(),
    sender_phone_velocity_max: z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional(),
    sender_phone_velocity_window_minutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .optional(),
    approved_sender_ids: z.array(z.string().trim().min(1).max(32)).optional(),
    refcode_brute_force_max: z.coerce
      .number()
      .int()
      .min(1)
      .max(10_000)
      .optional(),
    refcode_brute_force_window_minutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .optional(),
    reconciliation_variance_threshold: z.coerce.number().nonnegative().optional(),
  })
  .refine(
    (d) =>
      d.min_deposit === undefined ||
      d.max_deposit === undefined ||
      d.min_deposit <= d.max_deposit,
    {
      message: 'min_deposit must be <= max_deposit',
      path: ['min_deposit'],
    }
  )
  .refine((d) => Object.keys(d).length > 0, {
    message: 'no fields to update',
  });
export type UpdateTelebirrSettingsInput = z.infer<
  typeof updateTelebirrSettingsSchema
>;
