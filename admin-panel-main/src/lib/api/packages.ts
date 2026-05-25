import { http } from './client';

export interface PackageAssignment {
  id: string;
  package_id: string;
  client_name: string;
  client_tenant_id?: string | null;
  client_tenant_name?: string | null;
  client_tenant_slug?: string | null;
  user_id?: string | null;
  assigned_at: string;
}

export interface AdminPackage {
  id: string;
  name: string;
  tier: 'Starter' | 'Premium' | 'VIP';
  color: string;
  game_ids: string[];
  assignments: PackageAssignment[];
  created_at: string;
  updated_at: string;
}

export interface PackageClient {
  id: string;
  name: string;
  slug: string;
  status: string;
  current_package: { package_id: string; package_name: string } | null;
}

export function listPackages() {
  return http.get<AdminPackage[]>('/api/admin/packages');
}

export function listPackageClients() {
  return http
    .get<{ items: PackageClient[] }>('/api/admin/packages/clients')
    .then((r) => r.items);
}

export function createPackage(input: {
  name: string;
  tier: 'Starter' | 'Premium' | 'VIP';
  color?: string;
  game_ids: string[];
}) {
  return http.post<AdminPackage>('/api/admin/packages', input);
}

export function updatePackage(
  id: string,
  input: Partial<{ name: string; tier: 'Starter' | 'Premium' | 'VIP'; color: string; game_ids: string[] }>
) {
  return http.put<AdminPackage>(`/api/admin/packages/${id}`, input);
}

export function deletePackage(id: string) {
  return http.delete<{ id: string }>(`/api/admin/packages/${id}`);
}

export function listPackageAssignments(id: string) {
  return http.get<PackageAssignment[]>(`/api/admin/packages/${id}/assignments`);
}

export function assignClient(
  id: string,
  input: {
    client_name: string;
    client_tenant_id?: string;
    user_id?: string;
  }
) {
  return http.post<PackageAssignment>(`/api/admin/packages/${id}/assign`, input);
}

export function removePackageAssignment(packageId: string, assignId: string) {
  return http.delete<{ id: string }>(`/api/admin/packages/${packageId}/assign/${assignId}`);
}

