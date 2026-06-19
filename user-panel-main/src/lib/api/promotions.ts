import { apiRequest } from './client';

export interface PublicPromotion {
  id: string;
  title: string;
  description: string;
  type:
    | 'bonus'
    | 'raffle'
    | 'tournament'
    | 'loyalty_bonus'
    | 'welcome_bonus'
    | 'cashback_bonus'
    | 'referral_bonus'
    | 'free_bet';
  image_url?: string;
  terms: string;
  valid_to: string | null;
  cta_label: string;
  cta_url: string;
  is_claimed: boolean;
}

export function listActivePromotions() {
  return apiRequest<{ items: PublicPromotion[] }>('/api/promotions/active', {
    method: 'GET',
  });
}

export interface CashbackNotice {
  active: boolean;
  source?: 'versioned_rule' | 'bonus_settings';
  rule_id?: string | null;
  rule_name?: string;
  version?: number | null;
  schedule?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  payout_as?: 'bonus' | 'cash';
  min_loss?: number;
  pct?: number;
  max_cap?: number | null;
  vip_multipliers?: Record<string, number>;
}

export function getActiveCashbackNotice() {
  return apiRequest<CashbackNotice>('/api/promotions/cashback-notice', {
    method: 'GET',
  });
}

export interface CashbackRuleCard {
  rule_key: 'rule_one' | 'rule_two';
  label: string;
  is_active: boolean;
  slots: Array<{
    slot_key: 'loss_one' | 'loss_two' | 'loss_three';
    label: string;
    enabled: boolean;
    min_selections: number;
    min_odds_per_leg: number;
    min_stake: number;
    max_cashback: number;
    tiers: Array<{ min_odds: number; max_odds: number | null; pct: number }>;
  }>;
}

export interface CashbackRulesPayload {
  active_rule: 'rule_one' | 'rule_two';
  payout_as: 'bonus' | 'cash';
  active_profile?: {
    rule_id: string | null;
    rule_name: string | null;
    version: number | null;
  } | null;
  rules: CashbackRuleCard[];
}

export function listCashbackRules() {
  return apiRequest<CashbackRulesPayload>('/api/promotions/cashback-rules', {
    method: 'GET',
  });
}

export interface CashbackTestTicket {
  id: string;
  title: string;
  rule_key: 'rule_one' | 'rule_two';
  slot_key: 'loss_one' | 'loss_two' | 'loss_three';
  stake: number;
  legs: Array<{
    status: string;
    odds: number;
    is_live: boolean;
    is_virtual: boolean;
  }>;
  expected: {
    eligible: boolean;
    amount: number;
    reason: string;
    loss_count: number;
  };
}

export function listCashbackTestTickets() {
  return apiRequest<{ items: CashbackTestTicket[] }>('/api/promotions/cashback-test-tickets', {
    method: 'GET',
  });
}

export function evaluateCashbackTestTicket(input: {
  rule_key: 'rule_one' | 'rule_two';
  stake: number;
  legs: Array<{ status: string; odds: number; is_live: boolean; is_virtual: boolean }>;
}) {
  return apiRequest<{ verdict: { eligible: boolean; amount: number; reason: string } }>(
    '/api/promotions/cashback-test/evaluate',
    {
      method: 'POST',
      body: input,
    }
  );
}
