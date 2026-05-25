/**
 * /api/admin/configurations — settings-extra module that hosts SMS, security,
 * maintenance, API keys, iframes, packages, integrations, game-picks,
 * match-stats. Mounted by admin.routes.ts under /configurations.
 */
import { http } from './client';

export interface SmsTemplate {
  id: string;
  name: string;
  body: string;
  language: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export function listSmsTemplates() {
  return http.get<{ items: SmsTemplate[] }>('/api/admin/configurations/sms/templates');
}

export function createSmsTemplate(input: {
  name: string;
  body: string;
  language?: string;
}) {
  return http.post<SmsTemplate>('/api/admin/configurations/sms/templates', input);
}

export function updateSmsTemplate(id: string, input: Partial<SmsTemplate>) {
  return http.put<SmsTemplate>(`/api/admin/configurations/sms/templates/${id}`, input);
}

export function deleteSmsTemplate(id: string) {
  return http.delete<{ id: string }>(`/api/admin/configurations/sms/templates/${id}`);
}

export function getSmsConfig() {
  return http.get<Record<string, unknown>>('/api/admin/configurations/sms/config');
}

export function updateSmsConfig(input: Record<string, unknown>) {
  return http.put<Record<string, unknown>>('/api/admin/configurations/sms/config', input);
}

export function getSecuritySettings() {
  return http.get<Record<string, unknown>>('/api/admin/configurations/security');
}

export function updateSecuritySettings(input: Record<string, unknown>) {
  return http.put<Record<string, unknown>>('/api/admin/configurations/security', input);
}

export function getMaintenanceConfig() {
  return http.get<Record<string, unknown>>('/api/admin/configurations/maintenance/config');
}

export function updateMaintenanceConfig(input: Record<string, unknown>) {
  return http.put<Record<string, unknown>>(
    '/api/admin/configurations/maintenance/config',
    input
  );
}

export interface MaintenanceJob {
  id: string;
  name: string;
  cron: string;
  task: string;
  enabled: boolean;
  last_run_at: string | null;
  metadata?: Record<string, unknown>;
}

export function listMaintenanceJobs() {
  return http.get<{ items: MaintenanceJob[] }>('/api/admin/configurations/maintenance/jobs');
}

export function createMaintenanceJob(input: Partial<MaintenanceJob>) {
  return http.post<MaintenanceJob>('/api/admin/configurations/maintenance/jobs', input);
}

export function updateMaintenanceJob(id: string, input: Partial<MaintenanceJob>) {
  return http.put<MaintenanceJob>(`/api/admin/configurations/maintenance/jobs/${id}`, input);
}

export function deleteMaintenanceJob(id: string) {
  return http.delete<{ id: string }>(`/api/admin/configurations/maintenance/jobs/${id}`);
}

export function runMaintenanceJob(id: string) {
  return http.post<{ id: string; status: string }>(
    `/api/admin/configurations/maintenance/jobs/${id}/run`
  );
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scope: string[];
  active: boolean;
  created_at: string;
  revoked_at?: string | null;
  secret?: string;
}

export function listApiKeys() {
  return http.get<{ items: ApiKey[] }>('/api/admin/configurations/api-keys');
}

export function issueApiKey(input: { name: string; scope?: string[] }) {
  return http.post<ApiKey>('/api/admin/configurations/api-keys', input);
}

export function revokeApiKey(id: string) {
  return http.post<{ id: string; active: boolean }>(
    `/api/admin/configurations/api-keys/${id}/revoke`
  );
}

export interface IframeEntry {
  id: string;
  tenant_id?: string;
  name: string;
  slug: string;
  embed_url: string;
  width: string;
  height: string;
  allowed_origins: string[];
  is_active: boolean;
  visibility: 'admin' | 'user' | 'public';
  config?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export function listIframes() {
  return http.get<{ items: IframeEntry[] }>('/api/admin/configurations/iframes');
}

export function createIframe(input: Partial<IframeEntry>) {
  return http.post<IframeEntry>('/api/admin/configurations/iframes', input);
}

export function updateIframe(id: string, input: Partial<IframeEntry>) {
  return http.put<IframeEntry>(`/api/admin/configurations/iframes/${id}`, input);
}

export function toggleIframe(id: string) {
  return http.patch<IframeEntry>(`/api/admin/configurations/iframes/${id}/toggle`);
}

export function deleteIframe(id: string) {
  return http.delete<{ id: string }>(`/api/admin/configurations/iframes/${id}`);
}

export interface PackageRow {
  id: string;
  name: string;
  description?: string;
  price?: number;
  features?: Record<string, unknown>;
  is_active: boolean;
}

export function listPackages() {
  return http.get<{ items: PackageRow[] }>('/api/admin/configurations/packages');
}

export function createPackage(input: Partial<PackageRow>) {
  return http.post<PackageRow>('/api/admin/configurations/packages', input);
}

export function updatePackage(id: string, input: Partial<PackageRow>) {
  return http.put<PackageRow>(`/api/admin/configurations/packages/${id}`, input);
}

export function deletePackage(id: string) {
  return http.delete<{ id: string }>(`/api/admin/configurations/packages/${id}`);
}

export interface IntegrationRow {
  id: string;
  tenant_id?: string | null;
  name: string;
  kind: 'payment' | 'sms' | 'game_provider' | 'analytics' | 'custom';
  provider: string;
  base_url?: string | null;
  config?: Record<string, unknown>;
  secrets?: Record<string, unknown>;
  status?: 'active' | 'inactive' | 'error';
  last_health_at?: string | null;
  configured_secret_keys?: string[];
  created_at?: string;
  updated_at?: string;
}

export function listIntegrations() {
  return http.get<{ items: IntegrationRow[] }>('/api/admin/configurations/integrations');
}

export function upsertIntegration(input: Partial<IntegrationRow>) {
  return http.post<IntegrationRow>('/api/admin/configurations/integrations', input);
}

export function updateIntegration(id: string, input: Partial<IntegrationRow>) {
  return http.put<IntegrationRow>(`/api/admin/configurations/integrations/${id}`, input);
}

export function deleteIntegration(id: string) {
  return http.delete<{ id: string }>(`/api/admin/configurations/integrations/${id}`);
}

export function pingIntegration(id: string) {
  return http.post<{ id: string; ok: boolean; ping_at: string }>(
    `/api/admin/configurations/integrations/${id}/ping`
  );
}

export interface GamePick {
  id: string;
  match_id?: string;
  game_id?: string;
  label?: string;
  metadata?: Record<string, unknown>;
}

export function listGamePicks() {
  return http.get<{ items: GamePick[] }>('/api/admin/configurations/game-picks');
}

export function createGamePick(input: Partial<GamePick>) {
  return http.post<GamePick>('/api/admin/configurations/game-picks', input);
}

export function deleteGamePick(id: string) {
  return http.delete<{ id: string }>(`/api/admin/configurations/game-picks/${id}`);
}

export interface MatchStats {
  event_id: string;
  home_team?: string;
  away_team?: string;
  data?: Record<string, unknown>;
  updated_at?: string;
}

export function getMatchStats(eventId: string) {
  return http.get<MatchStats>(`/api/admin/configurations/match-stats/${eventId}`);
}

export function upsertMatchStats(input: MatchStats) {
  return http.put<MatchStats>('/api/admin/configurations/match-stats', input);
}
