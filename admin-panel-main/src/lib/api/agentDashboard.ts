/** /api/admin/agent-dashboard — agent-scoped shop KPIs (read-only). */
import { http } from './client';

export interface AgentDashboardTotals {
  cashier_deposit: string;
  withdrawal: string;
  shop_stake: string;
  paid_out: string;
  net_profit: string;
  won_tickets: number;
  lost_tickets: number;
  pending_tickets: number;
  total_tickets: number;
}

export interface AgentDashboardOption {
  id: string;
  label: string;
}

export interface AgentDashboardQuery
  extends Record<string, string | number | boolean | null | undefined> {
  from?: string;
  to?: string;
  branch_id?: string;
  sales_id?: string;
  agent_id?: string;
  tenant_id?: string;
}

export interface AgentDashboardResponse {
  tenant_id: string | null;
  agent_id: string | null;
  scoped_to_self: boolean;
  range: { from: string; to: string };
  filter: { branch_id: string | null; sales_id: string | null };
  totals: AgentDashboardTotals;
  branches: AgentDashboardOption[];
  sales: AgentDashboardOption[];
}

export function agentDashboard(query: AgentDashboardQuery = {}) {
  return http.get<AgentDashboardResponse>('/api/admin/agent-dashboard', {
    query,
  });
}

/* -------------------------------------------------------------------------- */
/* Agent ticket list (same columns as Offline Bets, scoped to the agent)       */
/* -------------------------------------------------------------------------- */

export interface AgentTicketRow {
  id: string;
  stake: string;
  actual_payout: string | null;
  status: string;
  currency: string;
  ticket_code: string | null;
  printed_ticket_code: string | null;
  coupon_code: string | null;
  sold_at: string | null;
  settled_at: string | null;
  placed_at: string | null;
  metadata: Record<string, unknown> | null;
  bet_for_user_phone: string | null;
  branch_id: string | null;
  branch_name: string | null;
  user_phone: string | null;
  user_name: string | null;
  cashier_email: string | null;
  cashier_name: string | null;
  sold_by_cashier_email: string | null;
  sold_by_cashier_name: string | null;
}

export interface AgentTicketsQuery
  extends Record<string, string | number | boolean | null | undefined> {
  from?: string;
  to?: string;
  branch_id?: string;
  sales_id?: string;
  status?: string;
  search?: string;
  agent_id?: string;
  tenant_id?: string;
  limit?: number;
  offset?: number;
}

export interface AgentTicketsResponse {
  items: AgentTicketRow[];
  total: number;
  limit: number;
  offset: number;
}

export function agentTickets(query: AgentTicketsQuery = {}) {
  return http.get<AgentTicketsResponse>('/api/admin/agent-dashboard/tickets', {
    query,
  });
}

export interface AgentTicketLeg {
  id: string;
  selection_label: string | null;
  current_odds: string | number | null;
  odds_at_placement: string | number | null;
  result: string | null;
  status: string;
  market_type: string | null;
  market_label: string | null;
  home_team: string | null;
  away_team: string | null;
  sport: string | null;
  league: string | null;
}

export interface AgentTicketDetail extends AgentTicketRow {
  paid_at: string | null;
  legs: AgentTicketLeg[];
}

export function agentTicketDetail(id: string) {
  return http.get<AgentTicketDetail>(
    `/api/admin/agent-dashboard/tickets/${id}`
  );
}
