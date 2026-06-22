/**
 * Settlement API client — admin panel bindings for
 * /api/admin/settlement/*
 */

import { http } from './client';

/* ------------------------------------------------------------------ */
/* Types                                                                */
/* ------------------------------------------------------------------ */

export type SettlementStatus =
  | 'pending'
  | 'live'
  | 'won'
  | 'lost'
  | 'postponed'
  | 'awaiting_settlement'
  | 'partially_voided'
  | 'fully_voided'
  | 'refunded'
  | 'cancelled'
  | 'manual_review'
  | 'settled'
  | 'error';

export interface SettlementTicket {
  id: string;
  tenant_id: string;
  user_id: string;
  user_email: string | null;
  user_phone: string | null;
  channel: string;
  bet_type: string;
  stake: string;
  currency: string;
  potential_payout: string;
  actual_payout: string | null;
  status: string;
  settlement_status: SettlementStatus | null;
  void_reason: string | null;
  settlement_reason: string | null;
  settlement_error: string | null;
  original_odds: string | null;
  recalculated_odds: string | null;
  total_odds: string | null;
  postponed_at: string | null;
  postpone_wait_hours: number;
  review_required: boolean;
  placed_at: string;
  settled_at: string | null;
  updated_at: string;
  coupon_code: string;
  total_legs: string;
  pending_legs: string;
  void_legs: string;
}

export interface SettlementLeg {
  id: string;
  selection_id: string;
  odds_at_placement: string;
  original_odds: string | null;
  settled_odds: string | null;
  status: string;
  selection_status: string | null;
  void_reason: string | null;
  settled_at: string | null;
  selection_label: string;
  selection_result: string | null;
  market_label: string;
  market_type: string;
  market_status: string;
  home_team: string;
  away_team: string;
  league: string;
  sport: string;
  starts_at: string;
  event_status: string;
}

export interface AuditLogEntry {
  id: string;
  bet_id: string;
  leg_id: string | null;
  action: string;
  old_status: string | null;
  new_status: string | null;
  old_odds: string | null;
  new_odds: string | null;
  stake: string | null;
  original_payout: string | null;
  recalculated_payout: string | null;
  void_reason: string | null;
  settlement_reason: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  actor_email: string | null;
  actor_role: string | null;
}

export interface SettlementTicketDetail extends SettlementTicket {
  legs: SettlementLeg[];
  audit: AuditLogEntry[];
}

export interface ListResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/* ------------------------------------------------------------------ */
/* API methods                                                          */
/* ------------------------------------------------------------------ */

export function listSettlementTickets(params: {
  filter?: 'unsettled' | 'errors' | 'all';
  page?: number;
  limit?: number;
}) {
  return http.get<ListResponse<SettlementTicket>>('/api/admin/settlement/tickets', {
    query: params as Record<string, unknown>,
  });
}

export function getSettlementTicket(id: string) {
  return http.get<SettlementTicketDetail>(`/api/admin/settlement/tickets/${id}`);
}

export function settleTicket(id: string, reason?: string) {
  return http.post<{ success: boolean; status: string; credit: number }>(
    `/api/admin/settlement/tickets/${id}/settle`,
    { reason }
  );
}

export function voidSelection(betId: string, legId: string, reason: string) {
  return http.post<{ success: boolean }>(
    `/api/admin/settlement/tickets/${betId}/void-selection/${legId}`,
    { reason }
  );
}

export function voidTicket(id: string, reason: string) {
  return http.post<{ success: boolean }>(
    `/api/admin/settlement/tickets/${id}/void-ticket`,
    { reason }
  );
}

export function recalculateTicket(id: string) {
  return http.post<{ success: boolean; recalculated_odds: number }>(
    `/api/admin/settlement/tickets/${id}/recalculate`
  );
}

export function extendWait(id: string, waitHours: number) {
  return http.post<{ success: boolean }>(
    `/api/admin/settlement/tickets/${id}/extend-wait`,
    { wait_hours: waitHours }
  );
}

export function forceWin(id: string, payout: number, reason?: string) {
  return http.post<{ success: boolean }>(
    `/api/admin/settlement/tickets/${id}/force-win`,
    { payout, reason }
  );
}

export function forceLose(id: string, reason?: string) {
  return http.post<{ success: boolean }>(
    `/api/admin/settlement/tickets/${id}/force-lose`,
    { reason }
  );
}

export function refundStake(id: string, reason?: string) {
  return http.post<{ success: boolean }>(
    `/api/admin/settlement/tickets/${id}/refund-stake`,
    { reason }
  );
}

export function reopenTicket(id: string, reason?: string) {
  return http.post<{ success: boolean }>(
    `/api/admin/settlement/tickets/${id}/reopen`,
    { reason }
  );
}

export function resettleTicket(id: string, reason?: string) {
  return http.post<{ success: boolean; status: string; credit: number }>(
    `/api/admin/settlement/tickets/${id}/resettle`,
    { reason }
  );
}

export function sendToManualReview(id: string, reason?: string) {
  return http.post<{ success: boolean }>(
    `/api/admin/settlement/tickets/${id}/manual-review`,
    { reason }
  );
}

export function postponeEvent(eventId: string, waitHours: number) {
  return http.post<{ success: boolean; affected_tickets: number }>(
    `/api/admin/settlement/events/${eventId}/postpone`,
    { wait_hours: waitHours }
  );
}

export function cancelEvent(eventId: string) {
  return http.post<{ success: boolean; settled: number }>(
    `/api/admin/settlement/events/${eventId}/cancel`
  );
}

export function runAutoSettle() {
  return http.post<{ success: boolean; processed: number }>(
    '/api/admin/settlement/run-auto-settle'
  );
}

export function listAuditLogs(params: { bet_id?: string; page?: number; limit?: number }) {
  return http.get<ListResponse<AuditLogEntry>>('/api/admin/settlement/audit-logs', {
    query: params as Record<string, unknown>,
  });
}
