/** /api/admin/bonuses */
import { http } from './client';
import type { Paged } from './types';

export type BonusRuleType =
  | 'signup'
  | 'deposit'
  | 'referral'
  | 'cashback'
  | 'free_bet'
  | 'loyalty'
  | 'tournament'
  | 'custom';

export type BonusRuleStatus = 'active' | 'paused' | 'expired' | 'disabled';

export interface BonusRule {
  id: string;
  tenant_id: string;
  name: string;
  type: BonusRuleType;
  config: Record<string, unknown>;
  is_active: boolean;
  valid_from: string | null;
  valid_to: string | null;
  priority: number;
  status: BonusRuleStatus;
  created_at: string;
  updated_at: string;
}

export interface BonusAssignment {
  id: string;
  tenant_id: string;
  bonus_rule_id: string;
  user_id: string;
  awarded_by: string | null;
  awarded_amount: string;
  wagering_required: string;
  wagering_progress: string;
  status: 'active' | 'completed' | 'forfeited' | 'expired' | 'cancelled';
  awarded_at: string;
  expires_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  user_email?: string | null;
  user_phone?: string | null;
}

export interface ListBonusesQuery {
  page?: number;
  limit?: number;
  type?: BonusRuleType;
  status?: BonusRuleStatus;
  search?: string;
}

export function listBonuses(query: ListBonusesQuery = {}) {
  return http.get<Paged<BonusRule>>('/api/admin/bonuses', { query });
}

export function getBonus(id: string) {
  return http.get<BonusRule>(`/api/admin/bonuses/${id}`);
}

export interface UpsertBonusInput {
  name: string;
  type: BonusRuleType;
  config?: Record<string, unknown>;
  is_active?: boolean;
  valid_from?: string | null;
  valid_to?: string | null;
  priority?: number;
  status?: BonusRuleStatus;
}

export function createBonus(input: UpsertBonusInput) {
  return http.post<BonusRule>('/api/admin/bonuses', input);
}

export function updateBonus(id: string, input: Partial<UpsertBonusInput>) {
  return http.put<BonusRule>(`/api/admin/bonuses/${id}`, input);
}

export function deleteBonus(id: string) {
  return http.delete<{ id: string; success?: boolean }>(`/api/admin/bonuses/${id}`);
}

export function patchBonusStatus(
  id: string,
  input: { status: BonusRuleStatus; is_active?: boolean }
) {
  return http.patch<BonusRule>(`/api/admin/bonuses/${id}/status`, input);
}

export function listBonusClaims(
  id: string,
  query: {
    page?: number;
    limit?: number;
    status?: BonusAssignment['status'];
  } = {}
) {
  return http.get<Paged<BonusAssignment>>(`/api/admin/bonuses/${id}/claims`, {
    query,
  });
}

export function awardBonus(
  id: string,
  input: {
    user_id: string;
    override_amount?: number;
    wagering_required_override?: number;
    expires_at?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  return http.post<BonusAssignment>(`/api/admin/bonuses/${id}/award`, input);
}

export function assignBonus(
  id: string,
  input: {
    user_ids?: string[];
    segment?: string;
    amount_override?: number;
    wagering_required_override?: number;
    expires_at?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  return http.post<Record<string, unknown>>(`/api/admin/bonuses/${id}/assign`, input);
}

/* ------------------------------------------------------------------ */
/* Bonus settings (Tab 2)                                              */
/* ------------------------------------------------------------------ */

export interface BonusSettings {
  global_enabled: boolean;
  default_wagering_multiplier: number;
  default_expiry_days: number;
  default_min_odds: number;
  cashback: {
    schedule: 'weekly' | 'monthly';
    payout_as: 'bonus' | 'cash';
    min_loss?: number;
    pct?: number;
  };
  deposit_match: { stack_with_promo: boolean };
}

export function getBonusSettings() {
  return http.get<BonusSettings>('/api/admin/bonuses/settings');
}

export function updateBonusSettings(input: BonusSettings) {
  return http.put<BonusSettings>('/api/admin/bonuses/settings', input);
}

/* ------------------------------------------------------------------ */
/* Free bets (Tab 3)                                                   */
/* ------------------------------------------------------------------ */

export interface FreeBetRow {
  id: string;
  bonus_rule_id: string;
  bonus_name: string;
  user_id: string;
  awarded_amount: string;
  wagering_required: string;
  wagering_progress: string;
  status: 'active' | 'completed' | 'forfeited' | 'expired' | 'cancelled';
  awarded_at: string;
  expires_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
  user_email: string | null;
  user_phone: string | null;
}

export function listFreeBets(query: {
  status?: FreeBetRow['status'];
  page?: number;
  limit?: number;
} = {}) {
  return http.get<Paged<FreeBetRow>>('/api/admin/bonuses/freebets', { query });
}

export function awardFreeBets(input: {
  user_id?: string;
  user_ids?: string[];
  segment?: string;
  amount: number;
  min_odds?: number;
  expires_in_days?: number;
  name?: string;
}) {
  return http.post<{
    ruleId: string;
    count: number;
    assignments: Array<{
      id: string;
      user_id: string;
      awarded_amount: string;
      expires_at: string;
      status: string;
    }>;
  }>('/api/admin/bonuses/freebets', input);
}
