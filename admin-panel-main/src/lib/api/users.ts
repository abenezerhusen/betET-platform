/** /api/admin/users — list / get / create / update / suspend / KYC / role */

import { http } from './client';
import type { AdminUser, Paged } from './types';

export interface ListUsersQuery {
  page?: number;
  limit?: number;
  role?: string;
  status?: string;
  kyc_status?: string;
  search?: string;
  /** Include aggregated wallet balance, bonus_balance, locked_balance per user. */
  with_balance?: boolean;
  /** Include total_won and last_bet_at per user. */
  with_activity?: boolean;
  [key: string]: string | number | boolean | null | undefined;
}

export function listUsers(query: ListUsersQuery = {}) {
  return http.get<Paged<AdminUser>>('/api/admin/users', { query });
}

export function getUser(id: string) {
  return http.get<AdminUser>(`/api/admin/users/${id}`);
}

export interface CreateUserInput {
  email?: string;
  phone?: string;
  password?: string;
  role?: string;
  kyc_status?: string;
  status?: string;
  metadata?: Record<string, unknown>;
}

export function createUser(input: CreateUserInput) {
  return http.post<AdminUser>('/api/admin/users', input);
}

export interface UpdateUserInput {
  email?: string | null;
  phone?: string | null;
  role?: string;
  status?: string;
  kyc_status?: string;
  metadata?: Record<string, unknown>;
}

export function updateUser(id: string, input: UpdateUserInput) {
  return http.put<AdminUser>(`/api/admin/users/${id}`, input);
}

export function suspendUser(id: string, reason: string) {
  return http.post<AdminUser>(`/api/admin/users/${id}/suspend`, { reason });
}

export type AdminUserStatus = 'active' | 'suspended' | 'disabled' | 'banned';

/**
 * Toggle a user's status. The backend automatically invalidates every
 * active session whenever `status !== 'active'` so the user is forced
 * out of the User Panel / mobile / admin app immediately.
 */
export function setUserStatus(
  id: string,
  status: AdminUserStatus,
  reason?: string
) {
  return http.patch<AdminUser>(`/api/admin/users/${id}/status`, {
    status,
    ...(reason ? { reason } : {}),
  });
}

/**
 * Admin "Change Password" action — overwrites the password and revokes
 * every refresh token so the user must log back in.
 */
export function changeUserPassword(id: string, password: string) {
  return http.patch<{ id: string; password_changed: true }>(
    `/api/admin/users/${id}/password`,
    { password }
  );
}

export function kycApprove(id: string) {
  return http.post<AdminUser>(`/api/admin/users/${id}/kyc-approve`);
}

export function kycReject(id: string, reason: string) {
  return http.post<AdminUser>(`/api/admin/users/${id}/kyc-reject`, { reason });
}

export interface UserActivityQuery {
  page?: number;
  limit?: number;
  type?: 'bets' | 'transactions' | 'all';
  from?: string;
  to?: string;
  [key: string]: string | number | boolean | null | undefined;
}

export function userActivity(id: string, query: UserActivityQuery = {}) {
  return http.get<{
    user: { id: string; tenant_id: string };
    items: Array<{
      type: 'bet' | 'transaction';
      id: string;
      amount: string;
      status: string;
      created_at: string;
      details: Record<string, unknown>;
    }>;
    total: number;
    page: number;
    limit: number;
    pages: number;
  }>(`/api/admin/users/${id}/activity`, { query });
}

export function assignRole(id: string, role: string) {
  return http.post<AdminUser>(`/api/admin/users/${id}/assign-role`, { role });
}
