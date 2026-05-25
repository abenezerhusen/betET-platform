/** /api/admin/dashboard — unified Section-2 KPIs (Summary / Offline / Online / Detailed). */
import { http } from './client';

export type DashboardTab = 'summary' | 'offline' | 'online' | 'detailed';

export interface DashboardStats {
  total_bets: number;
  total_stakes: string;
  paid_bets: number;
  cancelled_tickets: number;
  online_bets: number;
  won_bets: number;
  total_deposits: string;
  total_withdrawals: string;
  active_branches: number;
  active_users: number;
  deposit_bonus: string;
  loyalty_bonus: string;
  referral_bonus: string;
  free_bet_bonus: string;
  total_revenue: string;
  total_payouts: string;
}

export interface DashboardBranchRow {
  branch_id: string | null;
  branch_name: string | null;
  branch_code: string | null;
  stats: DashboardStats;
}

export interface DashboardResponse {
  tab: DashboardTab;
  range: { from: string; to: string };
  tenant_id: string | null;
  stats: DashboardStats;
  by_branch?: DashboardBranchRow[];
  cached_for_seconds: number;
}

export interface DashboardStatsQuery {
  tab?: DashboardTab;
  from?: string;
  to?: string;
  tenant_id?: string;
}

export function dashboardStats(query: DashboardStatsQuery = {}) {
  const cleaned: Record<string, string | number | boolean | null | undefined> = {
    tab: query.tab,
    from: query.from,
    to: query.to,
    tenant_id: query.tenant_id,
  };
  return http.get<DashboardResponse>('/api/admin/dashboard/stats', {
    query: cleaned,
  });
}
