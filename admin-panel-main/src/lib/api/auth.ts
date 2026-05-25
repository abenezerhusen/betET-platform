/** Auth endpoints — kept unauthenticated; tenant context is required. */

import { http, request } from './client';
import type { AuthTokens } from './types';

/**
 * Decide whether the identifier the operator typed should be sent as
 * `email`, `phone`, or `username`. Per the spec the admin login form
 * is username + password, but we still accept email/phone for users who
 * may not have a separate username metadata field.
 */
function classifyIdentifier(raw: string): 'email' | 'phone' | 'username' {
  const value = raw.trim();
  if (value.includes('@')) return 'email';
  // Treat values that look like phone numbers (digits, optional +, dashes,
  // spaces, parentheses) as phone. Everything else is a username.
  if (/^[+()\-\s\d]+$/.test(value) && /\d/.test(value)) return 'phone';
  return 'username';
}

/**
 * Admin panel login. Targets the spec endpoint /api/auth/admin/login which
 * enforces admin-tier roles (superadmin, tenant_admin, admin, agent, branch).
 */
export async function login(
  identifier: string,
  password: string
): Promise<AuthTokens> {
  const kind = classifyIdentifier(identifier);
  const payload =
    kind === 'email'
      ? { email: identifier.trim(), password }
      : kind === 'phone'
        ? { phone: identifier.trim(), password }
        : { username: identifier.trim(), password };
  return request<AuthTokens>('/api/auth/admin/login', {
    method: 'POST',
    body: payload,
    auth: false,
  });
}

export function refresh(refreshToken: string): Promise<AuthTokens> {
  return request<AuthTokens>('/api/auth/refresh', {
    method: 'POST',
    body: { refresh_token: refreshToken },
    auth: false,
  });
}

export function logout(refreshToken: string): Promise<{ success: boolean }> {
  return http.post('/api/auth/logout', { refresh_token: refreshToken }, { auth: false });
}

export function forgotPassword(
  identifier: string
): Promise<{ success: boolean; dev_token?: string }> {
  const kind = classifyIdentifier(identifier);
  const payload =
    kind === 'phone'
      ? { phone: identifier.trim() }
      : { email: identifier.trim() };
  return http.post('/api/auth/forgot-password', payload, { auth: false });
}

export function resetPassword(token: string, newPassword: string) {
  return http.post(
    '/api/auth/reset-password',
    { token, new_password: newPassword },
    { auth: false }
  );
}
