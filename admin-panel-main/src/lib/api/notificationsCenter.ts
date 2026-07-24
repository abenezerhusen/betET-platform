import { http } from './client';

export type BulkAudience = 'all' | 'active' | 'vip' | 'selected';
export type NotifChannel = 'sms' | 'telegram' | 'default';
export type BulkCategory = 'system' | 'marketing';

export interface BulkCampaign {
  id: string;
  title: string;
  message: string;
  audience: BulkAudience;
  channel: NotifChannel;
  category: BulkCategory;
  status: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface CreateBulkInput {
  title?: string;
  message: string;
  audience: BulkAudience;
  user_ids?: string[];
  channel: NotifChannel;
  category?: BulkCategory;
  event?: string;
}

export interface NotificationLogRow {
  id: string;
  user_id: string | null;
  channel: string;
  provider: string | null;
  category: string;
  event_type: string;
  recipient: string | null;
  message: string | null;
  status: string;
  error: string | null;
  created_at: string;
  sent_at: string | null;
}

const BASE = '/api/admin/notifications-center';

export const createBulk = (input: CreateBulkInput) =>
  http.post<{ id: string; total_recipients: number; status: string }>(`${BASE}/bulk`, input);

export const createSystemAnnouncement = (input: Omit<CreateBulkInput, 'category'>) =>
  http.post<{ id: string; total_recipients: number; status: string }>(`${BASE}/system`, input);

export const listBulk = (query: { page?: number; limit?: number; status?: string } = {}) =>
  http.get<{ items: BulkCampaign[]; page: number; limit: number; total: number }>(
    `${BASE}/bulk`,
    { query }
  );

export const getBulk = (id: string) => http.get<BulkCampaign>(`${BASE}/bulk/${id}`);

export const cancelBulk = (id: string) =>
  http.post<{ id: string; status: string }>(`${BASE}/bulk/${id}/cancel`);

export const listLogs = (
  query: {
    page?: number;
    limit?: number;
    channel?: string;
    status?: string;
    category?: string;
  } = {}
) =>
  http.get<{ items: NotificationLogRow[]; page: number; limit: number; total: number }>(
    `${BASE}/logs`,
    { query }
  );
