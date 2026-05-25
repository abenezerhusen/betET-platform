/** /api/admin/panel-reports — offline-cash / online-cash / payable */
import { http } from './client';

export interface OfflineCashQuery {
  from?: string;
  to?: string;
  cashier_id?: string;
}

export function offlineCashReport(query: OfflineCashQuery = {}) {
  return http.get<{
    summary: Record<string, string | null> | null;
    by_cashier: Array<Record<string, unknown>>;
    params: Record<string, unknown>;
  }>('/api/admin/panel-reports/offline-cash', { query });
}

export interface OnlineCashQuery {
  from?: string;
  to?: string;
}

export function onlineCashReport(query: OnlineCashQuery = {}) {
  return http.get<{
    summary: Record<string, string | null> | null;
    series?: Array<Record<string, unknown>>;
    params: Record<string, unknown>;
  }>('/api/admin/panel-reports/online-cash', { query });
}

export interface PayableQuery {
  from?: string;
  to?: string;
  status?:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'rejected'
    | 'cancelled'
    | 'failed';
}

export function payableReport(query: PayableQuery = {}) {
  return http.get<{
    withdrawals: {
      summary: Record<string, unknown> | null;
      items: Array<Record<string, unknown>>;
    };
    unsettled_won_bets: Record<string, unknown> | null;
    params: Record<string, unknown>;
  }>('/api/admin/panel-reports/payable', { query });
}
