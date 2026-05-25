/** /api/admin/reports — revenue / bets / users / transactions aggregates */
import { http } from './client';

export type Granularity = 'day' | 'week' | 'month';

export interface ReportQuery {
  from?: string;
  to?: string;
  tenant_id?: string;
  granularity?: Granularity;
}

export interface ReportResponse<S, P> {
  tenant_id: string | null;
  range: { from: string; to: string };
  granularity: Granularity;
  summary: S;
  series: P[];
  cached_for_seconds: number;
}

export interface RevenueSummary {
  bet_count: number;
  total_stake: string;
  total_payout: string;
  ggr: string;
}

export interface RevenueSeriesRow {
  period: string;
  bet_count: number;
  total_stake: string;
  total_payout: string;
  ggr: string;
}

export interface BetsSummary {
  total_bets: number;
  settled_bets: number;
  won_count: number;
  lost_count: number;
  void_count: number;
  pending_count: number;
  total_stake: string;
  total_payout: string;
  avg_stake: string;
  win_rate: number;
  margin: number;
}

export interface BetsSeriesRow {
  period: string;
  total_bets: number;
  total_stake: string;
  total_payout: string;
  ggr: string;
}

export interface UsersSummary {
  total_users: number;
  new_users: number;
  active_users: number;
  churned_users: number;
}

export interface UsersSeriesRow {
  period: string;
  new_users: number;
  active_users: number;
}

export interface TransactionsSummary {
  total_count: number;
  deposits_total: string;
  deposits_count: number;
  withdrawals_total: string;
  withdrawals_count: number;
  bets_total: string;
  payouts_total: string;
  bonus_total: string;
  adjustments_total: string;
  net_flow: string;
}

export interface TransactionsSeriesRow {
  period: string;
  deposits: string;
  withdrawals: string;
  bets: string;
  payouts: string;
}

export interface TransactionsByTypeRow {
  type: string;
  count: number;
  total: string;
}

export function revenueReport(query: ReportQuery = {}) {
  return http.get<ReportResponse<RevenueSummary, RevenueSeriesRow>>(
    '/api/admin/reports/revenue',
    { query }
  );
}

export function betsReport(query: ReportQuery = {}) {
  return http.get<ReportResponse<BetsSummary, BetsSeriesRow>>(
    '/api/admin/reports/bets',
    { query }
  );
}

export function usersReport(query: ReportQuery = {}) {
  return http.get<ReportResponse<UsersSummary, UsersSeriesRow>>(
    '/api/admin/reports/users',
    { query }
  );
}

export function transactionsReport(query: ReportQuery = {}) {
  return http.get<
    ReportResponse<TransactionsSummary, TransactionsSeriesRow> & {
      by_type: TransactionsByTypeRow[];
    }
  >('/api/admin/reports/transactions', { query });
}

/* ================================================================== */
/* Section 6 — Online / Offline Cash & Payable                          */
/* ================================================================== */

export interface OnlineCashSummary {
  total_stakes: string;
  total_payouts: string;
  net_revenue: string;
  bets_placed: number;
  paid_bets: number;
  bonus_cost: string;
}

export interface OnlineCashByDayRow {
  day: string;
  bets: number;
  stakes: string;
  payouts: string;
  net: string;
}

export interface OnlineCashBySportRow {
  sport: string;
  bets: number;
  stakes: string;
  payouts: string;
  net: string;
}

export interface OnlineCashQuery extends Record<string, string | number | boolean | null | undefined> {
  from?: string;
  to?: string;
  sport?: string;
  tenant_id?: string;
}

export interface OnlineCashResponse {
  tenant_id: string | null;
  range: { from: string; to: string };
  filter: { sport: string | null };
  summary: OnlineCashSummary;
  by_day: OnlineCashByDayRow[];
  by_sport: OnlineCashBySportRow[];
  cached_for_seconds: number;
}

export function onlineCashReport(query: OnlineCashQuery = {}) {
  return http.get<OnlineCashResponse>('/api/admin/reports/online-cash', { query });
}

export interface OfflineCashSummary {
  total_stakes: string;
  total_payouts: string;
  net_revenue: string;
  bets_placed: number;
  paid_bets: number;
}

export interface OfflineCashBranchRow {
  branch_id: string | null;
  branch_name: string;
  branch_code: string | null;
  bets: number;
  stakes: string;
  payouts: string;
  net: string;
}

export interface OfflineCashCashierRow {
  branch_id: string | null;
  branch_name: string;
  cashier_id: string;
  cashier_name: string;
  cashier_phone: string | null;
  bets: number;
  stakes: string;
  payouts: string;
  net: string;
}

export interface OfflineCashQuery extends Record<string, string | number | boolean | null | undefined> {
  from?: string;
  to?: string;
  branch_id?: string;
  cashier_id?: string;
  tenant_id?: string;
}

export interface OfflineCashResponse {
  tenant_id: string | null;
  range: { from: string; to: string };
  filter: { branch_id: string | null; cashier_id: string | null };
  summary: OfflineCashSummary;
  by_branch: OfflineCashBranchRow[];
  by_cashier: OfflineCashCashierRow[];
  cached_for_seconds: number;
}

export function offlineCashReport(query: OfflineCashQuery = {}) {
  return http.get<OfflineCashResponse>('/api/admin/reports/offline-cash', { query });
}

export type PayableScope = 'daily' | 'agent' | 'branch' | 'sales';
export type PayableStatus = 'pending' | 'approved' | 'rejected' | 'paid';

export interface PayableRecord {
  id: string;
  tenant_id: string;
  scope: PayableScope;
  entity_id: string | null;
  entity_label: string | null;
  period_date: string;
  total_stakes: string;
  total_payouts: string;
  total_payable: string;
  commission_rate: number | null;
  currency: string;
  status: PayableStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  paid_by: string | null;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface PayableQuery extends Record<string, string | number | boolean | null | undefined> {
  from?: string;
  to?: string;
  scope?: PayableScope;
  status?: PayableStatus;
  entity_id?: string;
  tenant_id?: string;
}

export interface PayableResponse {
  tenant_id: string;
  scope: PayableScope;
  range: { from: string; to: string };
  commission_rates: { agent: number; branch: number; sales: number };
  summary: {
    total: string;
    pending: string;
    approved: string;
    rejected: string;
    paid: string;
    rows: number;
  };
  items: PayableRecord[];
}

export function payableReport(query: PayableQuery = {}) {
  return http.get<PayableResponse>('/api/admin/reports/payable', { query });
}

export function approvePayable(id: string, notes?: string) {
  return http.patch<PayableRecord>(
    `/api/admin/reports/payable/${id}/approve`,
    { notes }
  );
}

export function rejectPayable(id: string, notes?: string) {
  return http.patch<PayableRecord>(
    `/api/admin/reports/payable/${id}/reject`,
    { notes }
  );
}

export function markPayablePaid(id: string, notes?: string) {
  return http.patch<PayableRecord>(
    `/api/admin/reports/payable/${id}/mark-paid`,
    { notes }
  );
}

export interface CommissionRates {
  agent: number;
  branch: number;
  sales: number;
}

export function getCommissionRates() {
  return http.get<{ tenant_id: string; rates: CommissionRates }>(
    '/api/admin/reports/payable/commission-rates'
  );
}

export function setCommissionRates(rates: Partial<CommissionRates>) {
  return http.put<{ tenant_id: string; rates: CommissionRates; updated_at: string }>(
    '/api/admin/reports/payable/commission-rates',
    rates
  );
}
