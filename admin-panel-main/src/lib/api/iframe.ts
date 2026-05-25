/**
 * /api/admin/iframe/configs — Section 14 spec-aligned iframe management.
 *
 * Reads/writes the `iframe_integrations` table via the dedicated iframe
 * router. The legacy /configurations/iframes/* endpoints still work but new
 * UI should use this client.
 */
import { http } from './client';

export interface IframeConfig {
  id: string;
  tenant_id?: string | null;
  name: string;
  slug: string;
  embed_url: string;
  width: string;
  height: string;
  allowed_origins: string[];
  is_active: boolean;
  visibility: 'admin' | 'user' | 'public';
  config: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface CreateIframeInput {
  name: string;
  slug: string;
  embed_url: string;
  category?: string;
  width?: string;
  height?: string;
  allow?: string;
  sandbox?: string;
  allowed_origins?: string[];
  is_active?: boolean;
  visibility?: 'admin' | 'user' | 'public';
  config?: Record<string, unknown>;
}

export function listIframeConfigs() {
  return http
    .get<{ items: IframeConfig[] }>('/api/admin/iframe/configs')
    .then((r) => r.items ?? []);
}

export function createIframeConfig(input: CreateIframeInput) {
  return http.post<IframeConfig>('/api/admin/iframe/configs', input);
}

export function updateIframeConfig(id: string, input: Partial<CreateIframeInput>) {
  return http.put<IframeConfig>(`/api/admin/iframe/configs/${id}`, input);
}

export function toggleIframeConfig(id: string) {
  return http.patch<IframeConfig>(`/api/admin/iframe/configs/${id}/toggle`);
}

export function deleteIframeConfig(id: string) {
  return http.delete<{ ok: boolean; id: string }>(`/api/admin/iframe/configs/${id}`);
}

/* ------------------------------------------------------------------------- */
/* Section 15 — Outbound iframe (we provide games to white-label clients)    */
/* ------------------------------------------------------------------------- */

export interface OutboundConfig {
  id: string;
  tenant_id: string;
  client_id: string;
  game_id: string | null;
  enabled: boolean;
  use_token: boolean;
  created_at: string;
  updated_at: string;
}

export interface WhitelistedDomain {
  id: string;
  domain: string;
  created_at?: string;
}

export interface OutboundConfigBundle {
  configs: OutboundConfig[];
  whitelisted_domains: WhitelistedDomain[];
}

export function getOutboundConfig() {
  return http.get<OutboundConfigBundle>('/api/admin/iframe/outbound/config');
}

export function upsertOutboundConfig(body: {
  client_id: string;
  game_id: string;
  enabled: boolean;
  use_token: boolean;
}) {
  return http.put<{ ok: boolean; config: OutboundConfig }>(
    '/api/admin/iframe/outbound/config',
    body
  );
}

export function addWhitelistDomain(domain: string) {
  return http.post<{ ok: boolean; domain: WhitelistedDomain }>(
    '/api/admin/iframe/outbound/domains',
    { domain }
  );
}

export function removeWhitelistDomain(domain: string) {
  return http.delete<{ ok: boolean }>(
    `/api/admin/iframe/outbound/domains/${encodeURIComponent(domain)}`
  );
}

/* ------------------------------------------------------------------------- */
/* Section 15 — Inbound iframe (external providers feed games to our panel)  */
/* ------------------------------------------------------------------------- */

export type ProviderStatus = 'Active' | 'Paused';
export type ProviderAuthMethod = 'token' | 'apikey' | 'none';

export interface ExternalProvider {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  base_url: string;
  auth_method: ProviderAuthMethod;
  callback_url: string | null;
  sandbox: boolean;
  status: ProviderStatus;
  last_ping: string | null;
  config: Record<string, unknown>;
  has_secret: boolean;
  created_at: string;
  updated_at: string;
  games: Array<{ game_id: string; enabled: boolean }>;
}

export function listExternalProviders() {
  return http
    .get<{ items: ExternalProvider[] }>('/api/admin/iframe/providers')
    .then((r) => r.items ?? []);
}

export function createExternalProvider(input: {
  name: string;
  base_url: string;
  auth_method?: ProviderAuthMethod;
  secret?: string;
  callback_url?: string;
  sandbox?: boolean;
  config?: Record<string, unknown>;
}) {
  return http.post<ExternalProvider>('/api/admin/iframe/providers', input);
}

export function patchExternalProvider(
  id: string,
  input: Partial<{
    name: string;
    base_url: string;
    auth_method: ProviderAuthMethod;
    secret: string;
    callback_url: string;
    sandbox: boolean;
    status: ProviderStatus;
    config: Record<string, unknown>;
  }>
) {
  return http.patch<ExternalProvider>(`/api/admin/iframe/providers/${id}`, input);
}

export function setExternalProviderStatus(id: string, status: ProviderStatus) {
  return http.patch<{ ok: boolean; id: string; status: ProviderStatus }>(
    `/api/admin/iframe/providers/${id}/status`,
    { status }
  );
}

export function deleteExternalProvider(id: string) {
  return http.delete<{ ok: boolean; id: string }>(`/api/admin/iframe/providers/${id}`);
}

export function addProviderGame(
  providerId: string,
  body: { game_id: string; name?: string; thumbnail_url?: string; enabled?: boolean }
) {
  return http.post<{ ok: boolean; game: { id: string; game_id: string; enabled: boolean } }>(
    `/api/admin/iframe/providers/${providerId}/games`,
    body
  );
}

export function removeProviderGame(providerId: string, gameId: string) {
  return http.delete<{ ok: boolean }>(
    `/api/admin/iframe/providers/${providerId}/games/${encodeURIComponent(gameId)}`
  );
}
