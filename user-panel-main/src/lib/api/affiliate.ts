/**
 * Affiliate self-service endpoints.
 *
 * An affiliate (agent) sees only their own record: statistics, commission
 * balance, referrals, payout accounts and withdrawal history. Withdrawals are
 * requested here and then approved + paid manually by an admin.
 */

import { apiRequest } from './client';

export interface AffiliatePayoutAccount {
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  telebirr_number: string;
}

export interface AffiliateSummary {
  is_affiliate: boolean;
  affiliate?: {
    id: string;
    name: string;
    code: string;
    plan: string;
    commission_pct: number;
    status: string;
    currency: string;
  };
  balance?: {
    earnings_total: number;
    reserved: number;
    available: number;
    total_paid: number;
  };
  stats?: {
    total_referrals: number;
    active_users: number;
    revenue_generated: number;
    clicks: number;
  };
  payout_account?: AffiliatePayoutAccount;
}

export interface AffiliateReferralRow {
  id: string;
  code: string;
  referred_user: string;
  bonus_amount: number;
  status: string;
  rewarded_at: string | null;
  created_at: string;
}

export interface AffiliateWithdrawalRow {
  id: string;
  amount: number;
  currency: string;
  method: 'bank' | 'telebirr';
  destination: Record<string, string>;
  status: 'pending' | 'approved' | 'paid' | 'rejected';
  reference: string | null;
  admin_note: string | null;
  requested_at: string | null;
  reviewed_at: string | null;
  paid_at: string | null;
  created_at: string;
}

export async function getAffiliateSummary(): Promise<AffiliateSummary> {
  return apiRequest<AffiliateSummary>('/api/user/me/affiliate');
}

export async function updateAffiliatePayoutAccount(
  input: Partial<AffiliatePayoutAccount>
): Promise<{ payout_account: AffiliatePayoutAccount }> {
  return apiRequest('/api/user/me/affiliate/payout-account', {
    method: 'PUT',
    body: input,
  });
}

export async function listAffiliateReferrals(query: {
  page?: number;
  limit?: number;
} = {}): Promise<{ items: AffiliateReferralRow[] }> {
  return apiRequest('/api/user/me/affiliate/referrals', {
    query: query as Record<string, number | undefined>,
  });
}

export async function listAffiliateWithdrawals(query: {
  page?: number;
  limit?: number;
} = {}): Promise<{ items: AffiliateWithdrawalRow[] }> {
  return apiRequest('/api/user/me/affiliate/withdrawals', {
    query: query as Record<string, number | undefined>,
  });
}

export async function requestAffiliateWithdrawal(input: {
  amount: number | string;
  method: 'bank' | 'telebirr';
}): Promise<{
  id: string;
  amount: number;
  currency: string;
  method: string;
  status: string;
  available_after: number;
}> {
  return apiRequest('/api/user/me/affiliate/withdrawals', {
    method: 'POST',
    body: input,
  });
}
