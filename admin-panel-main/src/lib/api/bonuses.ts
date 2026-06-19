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

export interface CashbackTier {
  min_odds: number;
  max_odds: number | null;
  pct: number;
}

export interface CashbackLossSlot {
  enabled: boolean;
  min_legs: number;
  min_leg_odds: number;
  min_stake: number;
  max_cashback: number;
  tiers: CashbackTier[];
}

export interface CashbackRuleConfig {
  loss_one: CashbackLossSlot;
  loss_two: CashbackLossSlot;
  loss_three?: CashbackLossSlot;
}

export interface PerTicketCashbackConfig {
  enabled: boolean;
  active_rule: 'rule_one' | 'rule_two';
  payout_as: 'bonus' | 'cash';
  exclude_live: boolean;
  exclude_virtual: boolean;
  rule_one: CashbackRuleConfig;
  rule_two: CashbackRuleConfig;
}

export interface BonusSettings {
  global_enabled: boolean;
  default_wagering_multiplier: number;
  default_expiry_days: number;
  default_min_odds: number;
  cashback: {
    schedule: 'daily' | 'weekly' | 'monthly' | 'yearly';
    payout_as: 'bonus' | 'cash';
    min_loss?: number;
    pct?: number;
    max_cap?: number;
    vip_multipliers?: Record<string, number>;
    per_ticket?: PerTicketCashbackConfig;
  };
  deposit_match: { stack_with_promo: boolean };
  cashback_rule_store?: CashbackRuleStore;
}

export function getBonusSettings() {
  return http.get<BonusSettings>('/api/admin/bonuses/settings');
}

export function updateBonusSettings(input: BonusSettings) {
  return http.put<BonusSettings>('/api/admin/bonuses/settings', input);
}

export interface CashbackRule {
  id: string;
  version: number;
  name: string;
  status: 'active' | 'inactive' | 'draft';
  is_active: boolean;
  config: BonusSettings['cashback'];
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface CashbackRuleStore {
  active_rule_id?: string | null;
  multi_rule_enabled?: boolean;
  rules: CashbackRule[];
}

export function listCashbackRules() {
  return http.get<CashbackRuleStore>('/api/admin/bonuses/settings/cashback-rules');
}

export function createCashbackRule(input: {
  name?: string;
  status?: 'active' | 'inactive' | 'draft';
  is_active?: boolean;
  config: BonusSettings['cashback'];
}) {
  return http.post<CashbackRuleStore>('/api/admin/bonuses/settings/cashback-rules', input);
}

export function updateCashbackRule(
  id: string,
  input: {
    name?: string;
    status?: 'active' | 'inactive' | 'draft';
    is_active?: boolean;
    config?: BonusSettings['cashback'];
  }
) {
  return http.put<CashbackRuleStore>(`/api/admin/bonuses/settings/cashback-rules/${id}`, input);
}

export function activateCashbackRule(id: string) {
  return http.post<CashbackRuleStore>(`/api/admin/bonuses/settings/cashback-rules/${id}/activate`, {});
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
