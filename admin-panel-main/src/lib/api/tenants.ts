/** /api/admin/tenants — superadmin only */

import { http } from './client';
import type { Paged, Tenant } from './types';

export interface ListTenantsQuery {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
}

export function listTenants(query: ListTenantsQuery = {}) {
  return http.get<Paged<Tenant>>('/api/admin/tenants', { query });
}

export function getTenant(id: string) {
  return http.get<Tenant>(`/api/admin/tenants/${id}`);
}

export interface CreateTenantInput {
  slug: string;
  name: string;
  status?: string;
  config?: Record<string, unknown>;
}

export function createTenant(input: CreateTenantInput) {
  return http.post<Tenant>('/api/admin/tenants', input);
}

export function updateTenant(id: string, input: Partial<CreateTenantInput>) {
  return http.put<Tenant>(`/api/admin/tenants/${id}`, input);
}

export function deleteTenant(id: string) {
  return http.delete<{ id: string }>(`/api/admin/tenants/${id}`);
}
