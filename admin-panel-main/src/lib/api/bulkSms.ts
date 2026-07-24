/**
 * API client for the Bulk SMS marketing module (phone gateway / TextBee).
 *
 * Isolated from `settings.ts` (OTP SMS/Telegram) — talks only to
 * /api/admin/bulk-sms/*. All endpoints require the `marketing.bulk_sms`
 * permission (Super Admin by default; grantable to an Administrator role).
 */

import { http } from './client';

const BASE = '/api/admin/bulk-sms';

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */
export interface GatewaySettings {
  configured: boolean;
  enabled: boolean;
  gateway_name: string;
  api_url: string;
  api_key_masked: string | null;
  has_api_key: boolean;
  device_id: string;
  sender_number: string;
  default_country_code: string;
  max_sms_per_day: number;
  delay_ms: number;
  updated_at: string | null;
}

export interface GatewaySettingsInput {
  enabled?: boolean;
  gateway_name?: string;
  api_url?: string;
  /** Empty / omitted keeps the stored key. */
  api_key?: string;
  device_id?: string;
  sender_number?: string;
  default_country_code?: string;
  max_sms_per_day?: number;
  delay_ms?: number;
}

export interface GatewayTestResult {
  ok: boolean;
  status: number;
  response: unknown;
  error: string | null;
  phone?: string;
}

export interface Template {
  id: string;
  tenant_id: string;
  name: string;
  body: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface Campaign {
  id: string;
  tenant_id: string;
  name: string;
  template_id: string | null;
  message: string;
  status: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface CampaignCreateResult extends Campaign {
  import: { total: number; valid: number; invalid: number; duplicates: number };
  remaining_daily: number;
}

export interface QueueRow {
  id: string;
  campaign_id: string;
  campaign_name: string | null;
  phone: string;
  message: string;
  status: string;
  attempts: number;
  error: string | null;
  next_attempt_at: string;
  sent_at: string | null;
  created_at: string;
}

export interface LogRow {
  id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  phone: string;
  message: string;
  status: string;
  provider_response: unknown;
  error: string | null;
  sent_at: string | null;
  created_at: string;
}

export interface Recipient {
  phone: string;
  vars?: Record<string, string>;
}

export interface CampaignCreateInput {
  name: string;
  template_id?: string;
  message: string;
  recipients: Recipient[];
  start?: boolean;
}

export interface ReportSummary {
  totals: { sent: number; failed: number; today: number };
  campaigns: number;
  queue_pending: number;
  daily_limit: number;
  remaining_today: number;
  gateway_enabled: boolean;
}

interface ListResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

type ListQuery = {
  page?: number;
  limit?: number;
  status?: string;
  search?: string;
  campaign_id?: string;
};

/* -------------------------------------------------------------------------- */
/*  Gateway settings                                                          */
/* -------------------------------------------------------------------------- */
export const getGatewaySettings = () =>
  http.get<GatewaySettings>(`${BASE}/gateway-settings`);

export const saveGatewaySettings = (input: GatewaySettingsInput) =>
  http.put<GatewaySettings>(`${BASE}/gateway-settings`, input);

export const testConnection = () =>
  http.post<GatewayTestResult>(`${BASE}/gateway-settings/test`);

export const sendTestSms = (phone: string, message?: string) =>
  http.post<GatewayTestResult>(`${BASE}/gateway-settings/test-sms`, {
    phone,
    message,
  });

/* -------------------------------------------------------------------------- */
/*  Templates                                                                 */
/* -------------------------------------------------------------------------- */
export const listTemplates = (query: ListQuery = {}) =>
  http.get<ListResult<Template>>(`${BASE}/templates`, { query });

export const createTemplate = (input: { name: string; body: string }) =>
  http.post<Template>(`${BASE}/templates`, input);

export const updateTemplate = (
  id: string,
  input: { name?: string; body?: string }
) => http.put<Template>(`${BASE}/templates/${id}`, input);

export const deleteTemplate = (id: string) =>
  http.delete<{ success: boolean; id: string }>(`${BASE}/templates/${id}`);

/* -------------------------------------------------------------------------- */
/*  Campaigns                                                                 */
/* -------------------------------------------------------------------------- */
export const createCampaign = (input: CampaignCreateInput) =>
  http.post<CampaignCreateResult>(`${BASE}/campaigns`, input);

export const listCampaigns = (query: ListQuery = {}) =>
  http.get<ListResult<Campaign>>(`${BASE}/campaigns`, { query });

export const getCampaign = (id: string) =>
  http.get<Campaign>(`${BASE}/campaigns/${id}`);

export const cancelCampaign = (id: string) =>
  http.post<{ id: string; status: string }>(`${BASE}/campaigns/${id}/cancel`);

/* -------------------------------------------------------------------------- */
/*  Queue / logs / reports                                                    */
/* -------------------------------------------------------------------------- */
export const listQueue = (query: ListQuery = {}) =>
  http.get<ListResult<QueueRow>>(`${BASE}/queue`, { query });

export const listLogs = (query: ListQuery = {}) =>
  http.get<ListResult<LogRow>>(`${BASE}/logs`, { query });

export const getReports = () => http.get<ReportSummary>(`${BASE}/reports`);
