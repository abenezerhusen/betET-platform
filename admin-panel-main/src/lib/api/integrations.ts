/**
 * /api/admin/integrations — Section 14 spec-aligned integration management.
 *
 * Backed by the api_integrations table. Secrets (api_key, etc.) are never
 * echoed back to the client — only the set of configured key names is
 * returned via `configured_secret_keys`.
 */
import { http } from './client';

export type IntegrationKind =
  | 'payment'
  | 'sms'
  | 'game_provider'
  | 'odds'
  | 'analytics'
  | 'custom';
export type IntegrationStatus = 'active' | 'inactive' | 'error';

export interface IntegrationRow {
  id: string;
  tenant_id?: string | null;
  name: string;
  kind: IntegrationKind;
  provider: string;
  base_url?: string | null;
  config: Record<string, unknown>;
  status: IntegrationStatus;
  last_health_at?: string | null;
  created_at?: string;
  updated_at?: string;
  configured_secret_keys?: string[];
}

export function listIntegrations() {
  return http
    .get<{ items: IntegrationRow[] }>('/api/admin/integrations')
    .then((r) => r.items ?? []);
}

export function createIntegration(input: {
  name: string;
  kind: IntegrationKind;
  provider: string;
  base_url?: string;
  secrets?: Record<string, unknown>;
  config?: Record<string, unknown>;
  status?: IntegrationStatus;
}) {
  return http.post<IntegrationRow>('/api/admin/integrations', input);
}

export function patchIntegration(
  id: string,
  input: {
    name?: string;
    kind?: IntegrationKind;
    provider?: string;
    base_url?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
    status?: IntegrationStatus;
  }
) {
  return http.patch<IntegrationRow>(`/api/admin/integrations/${id}`, input);
}

export function updateIntegrationKey(
  id: string,
  input: { api_key?: string; secret?: string; secrets?: Record<string, unknown> }
) {
  return http.post<{ id: string; provider: string; configured_secret_keys: string[] }>(
    `/api/admin/integrations/${id}/key`,
    input
  );
}

export function testIntegration(id: string) {
  return http.post<{
    id: string;
    ok: boolean;
    status: string;
    last_health_at: string;
    probe_status: 'connected' | 'failed' | 'unsupported' | 'untested';
    detail: string | null;
  }>(`/api/admin/integrations/${id}/test`);
}

export function deleteIntegration(id: string) {
  return http.delete<{ ok: boolean; id: string }>(`/api/admin/integrations/${id}`);
}
