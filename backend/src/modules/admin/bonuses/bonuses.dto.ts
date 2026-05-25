import { z } from 'zod';

export const BONUS_TYPES = [
  'signup',
  'deposit',
  'referral',
  'cashback',
  'free_bet',
  'loyalty',
  'tournament',
  'custom',
] as const;

export const BONUS_STATUSES = [
  'active',
  'paused',
  'expired',
  'disabled',
] as const;

export const SEGMENTS = [
  'all',
  'all_active',
  'kyc_verified',
  'kyc_pending',
  'active_30d',
  'new_users',
  'inactive_30d',
] as const;

const bonusConfigSchema = z
  .object({
    amount: z.number().nonnegative().optional(),
    percentage: z.number().min(0).max(100).optional(),
    max_amount: z.number().nonnegative().optional(),
    min_deposit: z.number().nonnegative().optional(),
    wagering_multiplier: z.number().nonnegative().optional(),
    expires_in_days: z.number().int().nonnegative().optional(),
    eligible_games: z.array(z.string().uuid()).optional(),
    eligible_currencies: z.array(z.string().min(2).max(8)).optional(),
    description: z.string().max(2000).optional(),
  })
  .passthrough()
  .default({});

export const listBonusesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  type: z.enum(BONUS_TYPES).optional(),
  status: z.enum(BONUS_STATUSES).optional(),
  is_active: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .optional(),
  search: z.string().trim().max(255).optional(),
});

export const createBonusSchema = z.object({
  name: z.string().trim().min(1).max(255),
  type: z.enum(BONUS_TYPES),
  config: bonusConfigSchema.optional(),
  is_active: z.boolean().default(true),
  valid_from: z.coerce.date().nullable().optional(),
  valid_to: z.coerce.date().nullable().optional(),
  priority: z.number().int().default(0),
  status: z.enum(BONUS_STATUSES).default('active'),
});

export const updateBonusSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    type: z.enum(BONUS_TYPES).optional(),
    config: bonusConfigSchema.optional(),
    is_active: z.boolean().optional(),
    valid_from: z.coerce.date().nullable().optional(),
    valid_to: z.coerce.date().nullable().optional(),
    priority: z.number().int().optional(),
    status: z.enum(BONUS_STATUSES).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });

export const assignBonusSchema = z
  .object({
    user_ids: z.array(z.string().uuid()).max(10000).optional(),
    segment: z.enum(SEGMENTS).optional(),
    amount_override: z.number().nonnegative().optional(),
    wagering_required_override: z.number().nonnegative().optional(),
    expires_at: z.coerce.date().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine(
    (d) => (d.user_ids && d.user_ids.length > 0) || Boolean(d.segment),
    { message: 'Provide either user_ids or segment' }
  );

export const patchBonusStatusSchema = z.object({
  status: z.enum(BONUS_STATUSES),
  is_active: z.boolean().optional(),
});

export const listBonusClaimsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  status: z
    .enum(['active', 'completed', 'forfeited', 'expired', 'cancelled'])
    .optional(),
});

export const manualAwardSchema = z.object({
  user_id: z.string().uuid(),
  override_amount: z.number().nonnegative().optional(),
  wagering_required_override: z.number().nonnegative().optional(),
  expires_at: z.coerce.date().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const internalEvaluateSchema = z.object({
  tenant_id: z.string().uuid(),
  user_id: z.string().uuid(),
  event_type: z.enum(['deposit', 'registration']),
  amount: z.number().nonnegative().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type ListBonusesQuery = z.infer<typeof listBonusesSchema>;
export type CreateBonusInput = z.infer<typeof createBonusSchema>;
export type UpdateBonusInput = z.infer<typeof updateBonusSchema>;
export type AssignBonusInput = z.infer<typeof assignBonusSchema>;
export type PatchBonusStatusInput = z.infer<typeof patchBonusStatusSchema>;
export type ListBonusClaimsInput = z.infer<typeof listBonusClaimsSchema>;
export type ManualAwardInput = z.infer<typeof manualAwardSchema>;
export type InternalEvaluateInput = z.infer<typeof internalEvaluateSchema>;
export type Segment = (typeof SEGMENTS)[number];
