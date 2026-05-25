/**
 * Authentication API for end-users (`/api/auth/*`).
 */

import { apiRequest } from './client';
import { clearSession, getRefreshToken, setSession } from '../auth/session';
import type { LoginResponse, AuthUserSummary } from './types';

export interface LoginInput {
  email?: string;
  phone?: string;
  password: string;
}

export interface RegisterInput {
  full_name: string;
  email?: string;
  phone?: string;
  password: string;
  referral_code?: string;
}

export interface ForgotPasswordInput {
  email?: string;
  phone?: string;
}

export interface ResetPasswordInput {
  token: string;
  new_password: string;
}

export async function login(input: LoginInput): Promise<LoginResponse> {
  const data = await apiRequest<LoginResponse>('/api/auth/login', {
    method: 'POST',
    body: {
      email: input.email,
      phone: input.phone,
      password: input.password,
    },
    skipAuth: true,
  });
  setSession({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accessTokenExpiresAt: data.access_token_expires_at,
    refreshTokenExpiresAt: data.refresh_token_expires_at,
    user: data.user,
  });
  return data;
}

/** Registers then signs in with the same credentials. */
export async function register(input: RegisterInput): Promise<LoginResponse> {
  await apiRequest('/api/auth/register', {
    method: 'POST',
    body: {
      full_name: input.full_name,
      phone: input.phone,
      email: input.email,
      password: input.password,
      referral_code: input.referral_code,
    },
    skipAuth: true,
  });
  return login({
    phone: input.phone,
    email: input.email,
    password: input.password,
  });
}

export async function logout(): Promise<void> {
  const refreshToken = getRefreshToken();
  try {
    if (refreshToken) {
      await apiRequest('/api/auth/logout', {
        method: 'POST',
        body: { refresh_token: refreshToken },
      });
    }
  } catch {
    /* proceed */
  }
  clearSession();
}

/** GET `/api/user/me` — profile + wallets (same handler as backend `getMe`). */
export async function me(): Promise<{
  profile: Record<string, unknown>;
  wallets: unknown[];
}> {
  return apiRequest('/api/user/me', { method: 'GET' });
}

export async function forgotPassword(
  input: ForgotPasswordInput
): Promise<{ success: boolean }> {
  return apiRequest('/api/auth/forgot-password', {
    method: 'POST',
    body: input,
    skipAuth: true,
  });
}

export async function resetPassword(input: ResetPasswordInput): Promise<{ success: boolean }> {
  return apiRequest('/api/auth/reset-password', {
    method: 'POST',
    body: { token: input.token, new_password: input.new_password },
    skipAuth: true,
  });
}

export async function changePassword(input: {
  current_password: string;
  new_password: string;
}): Promise<{ message?: string }> {
  return apiRequest('/api/user/me/change-password', {
    method: 'POST',
    body: input,
  });
}
