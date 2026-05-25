/** /api/admin/roles */
import { http } from './client';
import type { Paged } from './types';

export interface Role {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  permissions: string[] | Record<string, unknown>;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export function listRoles(query: { page?: number; limit?: number; search?: string } = {}) {
  return http.get<Paged<Role>>('/api/admin/roles', { query });
}

export function getRole(id: string) {
  return http.get<Role>(`/api/admin/roles/${id}`);
}

export interface CreateRoleInput {
  name: string;
  slug?: string;
  permissions: string[] | Record<string, unknown>;
}

export function createRole(input: CreateRoleInput) {
  return http.post<Role>('/api/admin/roles', input);
}

export function updateRole(id: string, input: Partial<CreateRoleInput>) {
  return http.put<Role>(`/api/admin/roles/${id}`, input);
}

/**
 * Section 22 — focused permissions write. The Super Admin "Role
 * Settings" modal calls this when saving a permission selection so
 * other role fields (name, description, status) are not accidentally
 * touched.
 */
export function updateRolePermissions(id: string, permissions: string[]) {
  return http.put<Role>(`/api/admin/roles/${id}/permissions`, { permissions });
}

export function deleteRole(id: string) {
  return http.delete<{ id: string }>(`/api/admin/roles/${id}`);
}
