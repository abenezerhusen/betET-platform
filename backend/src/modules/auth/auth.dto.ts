import { z } from 'zod';

export const loginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().min(3).max(32).optional(),
    username: z.string().trim().min(2).max(64).optional(),
    branch_id: z.string().trim().min(2).max(128).optional(),
    password: z.string().min(1).max(256),
  })
  .refine((d) => Boolean(d.email) || Boolean(d.phone) || Boolean(d.username), {
    message: 'One of email, phone, or username is required',
    path: ['username'],
  });

/**
 * Cashier panel login schema. Identical to `loginSchema` except:
 *
 *   - `branch_id` is REQUIRED (the cashier panel pins each session to a
 *     specific shop floor, and the service layer cross-checks the
 *     provided code against the user's `metadata.branch_id` /
 *     `metadata.branch_code` / `metadata.branch_user_id`).
 *
 * Use this schema only on `/api/auth/cashier/login`. The regular
 * `/api/auth/login` still treats branch_id as optional so admins, sales
 * managers and users who aren't tied to a single branch can still
 * authenticate.
 */
export const cashierLoginSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().min(3).max(32).optional(),
    username: z.string().trim().min(2).max(64).optional(),
    branch_id: z
      .string({ required_error: 'Branch ID is required' })
      .trim()
      .min(2, 'Branch ID is required')
      .max(128),
    password: z.string().min(1).max(256),
  })
  .refine((d) => Boolean(d.email) || Boolean(d.phone) || Boolean(d.username), {
    message: 'One of email, phone, or username is required',
    path: ['username'],
  });

export const registerSchema = z
  .object({
    full_name: z.string().trim().min(2).max(120),
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().min(8).max(32).optional(),
    password: z.string().min(4).max(128),
    referral_code: z.string().trim().min(2).max(40).optional(),
  })
  .refine((d) => Boolean(d.email) || Boolean(d.phone), {
    message: 'Either email or phone is required',
    path: ['email'],
  });

export const refreshSchema = z.object({
  refresh_token: z.string().min(1).max(8192),
});

export const logoutSchema = z.object({
  refresh_token: z.string().min(1).max(8192),
});

export const forgotPasswordSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().optional(),
    phone: z.string().trim().min(3).max(32).optional(),
  })
  .refine((d) => Boolean(d.email) || Boolean(d.phone), {
    message: 'Either email or phone is required',
    path: ['email'],
  });

export const resetPasswordSchema = z.object({
  token: z.string().min(16).max(512),
  new_password: z.string().min(8).max(128),
});

export const changePasswordSchema = z.object({
  current_password: z.string().min(1).max(256),
  new_password: z.string().min(8).max(128),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type CashierLoginInput = z.infer<typeof cashierLoginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type LogoutInput = z.infer<typeof logoutSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
