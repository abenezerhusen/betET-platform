import { z } from 'zod';

export const ROLE_VALUES = [
  'superadmin',
  'tenant_admin',
  'admin',
  'agent',
  'branch',
  'cashier',
  'sales',
  'operator',
  'user',
  'affiliate',
] as const;

export const STATUS_VALUES = [
  'active',
  'suspended',
  'disabled',
  'pending',
  'banned',
] as const;

export const KYC_VALUES = [
  'pending',
  'submitted',
  'verified',
  'rejected',
  'expired',
] as const;

/**
 * The Online Users page in the admin panel calls this endpoint with
 * `role=online_user` (the spec name for end-users registered through the
 * User Panel). Internally that maps to the database role `user`.
 *
 * Important: offline/shop-based accounts (agent / branch / sales /
 * cashier / admin tiers) live on the `users` table too but with a
 * different `role`. The strict equality filter (`u.role = 'user'`) is
 * therefore enough to exclude them — and a defensive `role NOT IN
 * (...staff...)` clause is layered on top in the repository whenever
 * the caller used the `online_user` alias.
 */
const ONLINE_USER_ALIAS = 'online_user';

export const listUsersSchema = z
  .preprocess((raw) => {
    // Capture whether the caller asked for the "online_user" alias **before**
    // we transform `role` to the underlying DB value, so the repository can
    // layer a stricter "no staff in this list" guard on top.
    if (raw && typeof raw === 'object') {
      const r = (raw as { role?: unknown }).role;
      if (r === ONLINE_USER_ALIAS) {
        return {
          ...(raw as Record<string, unknown>),
          role: 'user',
          _online_users_alias: true,
        };
      }
      // The admin Sales page manages retail/POS staff. Cashier accounts share
      // this concept (both `sales` and `cashier` log into the cashier panel),
      // so surface both roles in the Sales list.
      if (r === 'sales') {
        return {
          ...(raw as Record<string, unknown>),
          _include_cashier_alias: true,
        };
      }
    }
    return raw;
  }, z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(500).default(50),
    role: z.enum(ROLE_VALUES).optional(),
    status: z.enum(STATUS_VALUES).optional(),
    kyc_status: z.enum(KYC_VALUES).optional(),
    search: z.string().trim().max(255).optional(),
    /** When true, joins wallet aggregates (balance/bonus_balance/locked) per user. */
    with_balance: z.coerce.boolean().optional(),
    /** When true, includes total_won and last_bet_at computed from bets/sportsbook_bets. */
    with_activity: z.coerce.boolean().optional(),
    /**
     * Set internally by the preprocess step above when the caller used
     * the `online_user` alias. Not exposed as a public query parameter.
     */
    _online_users_alias: z.boolean().optional(),
    /**
     * Set internally when the caller filtered by `role=sales`; widens the
     * list to include `cashier` accounts too.
     */
    _include_cashier_alias: z.boolean().optional(),
  }));

export const createUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().min(3).max(32).optional(),
    password: z.string().min(8).max(128).optional(),
    role: z.enum(ROLE_VALUES).default('user'),
    kyc_status: z.enum(KYC_VALUES).optional(),
    status: z.enum(STATUS_VALUES).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((d) => Boolean(d.email) || Boolean(d.phone), {
    message: 'Either email or phone is required',
    path: ['email'],
  })
  .superRefine((d, ctx) => {
    const md = (d.metadata ?? {}) as Record<string, unknown>;
    if (d.role === 'branch') {
      const agentId = typeof md.agent_id === 'string' ? md.agent_id.trim() : '';
      if (!agentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metadata', 'agent_id'],
          message: 'Agent is required for branch accounts',
        });
      }
    }
    if (d.role === 'sales') {
      const agentId = typeof md.agent_id === 'string' ? md.agent_id.trim() : '';
      const branchId = typeof md.branch_id === 'string' ? md.branch_id.trim() : '';
      if (!agentId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metadata', 'agent_id'],
          message: 'Agent is required for sales accounts',
        });
      }
      if (!branchId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['metadata', 'branch_id'],
          message: 'Branch is required for sales accounts',
        });
      }
    }
  });

export const updateUserSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().nullable().optional(),
    phone: z.string().trim().min(3).max(32).nullable().optional(),
    role: z.enum(ROLE_VALUES).optional(),
    status: z.enum(STATUS_VALUES).optional(),
    kyc_status: z.enum(KYC_VALUES).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'no fields to update',
  });

export const suspendUserSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

/**
 * Generic status toggle endpoint used by the admin panel. Accepts only the
 * statuses an admin may set from the UI; KYC and pending are managed
 * elsewhere.
 */
export const userStatusSchema = z.object({
  status: z.enum(['active', 'suspended', 'disabled', 'banned']),
  reason: z.string().trim().max(1000).optional(),
});

export const changeUserPasswordSchema = z.object({
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long'),
});

export const kycRejectSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
});

export const userActivitySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  type: z.enum(['bets', 'transactions', 'all']).default('all'),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const assignRoleSchema = z.object({
  role: z.enum(ROLE_VALUES),
});

/**
 * Section 23 — Role Settings modal payload.
 *
 *   PUT /api/admin/users/:id/permissions
 *   { "permissions": ["dashboard.view", "bets.online.view", ...] }
 *
 * The permission IDs are validated as plain strings; the admin panel owns
 * the catalog. Server simply stores the list in `users.metadata.permissions`
 * and the auth service reads it back at login / refresh time.
 */
export const updatePermissionsSchema = z.object({
  permissions: z
    .array(z.string().trim().min(1).max(120))
    .max(500, 'Too many permissions in one request'),
});

export type ListUsersQuery = z.infer<typeof listUsersSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type SuspendUserInput = z.infer<typeof suspendUserSchema>;
export type UserStatusInput = z.infer<typeof userStatusSchema>;
export type ChangeUserPasswordInput = z.infer<typeof changeUserPasswordSchema>;
export type KycRejectInput = z.infer<typeof kycRejectSchema>;
export type UserActivityQuery = z.infer<typeof userActivitySchema>;
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
export type UpdatePermissionsInput = z.infer<typeof updatePermissionsSchema>;
