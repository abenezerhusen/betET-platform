/**
 * Online Payment gateway endpoints (Telebirr / CBE Birr / M-Pesa).
 *
 * A NEW, independent surface from the Telebirr P2P deposit/withdrawal and
 * branch-withdrawal flows in `wallet.ts`. All methods and settings are
 * driven by the Admin Payment Configuration page. Designed so a real
 * payment-gateway API (redirect + webhook) can be wired in later without
 * changing this client's shape.
 */

import { apiRequest } from './client';

export interface GatewayMethod {
  id: string;
  provider_slug: string;
  name: string;
  logo_url: string | null;
  min_amount: string | null;
  max_amount: string | null;
  supports_deposit: boolean;
  supports_withdrawal: boolean;
}

export interface GatewayConfig {
  methods: GatewayMethod[];
  allow_phone_number_editing: boolean;
  phone: string | null;
}

export interface GatewayRequest {
  id: string;
  direction: 'deposit' | 'withdrawal';
  provider_slug: string;
  method_name: string;
  amount: string;
  currency: string;
  phone: string;
  status: string;
  reference: string | null;
  redirect_url: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface GatewayInitiateInput {
  provider_slug: string;
  amount: string | number;
  phone?: string;
}

export async function getGatewayConfig(
  channel: 'deposit' | 'withdrawal'
): Promise<GatewayConfig> {
  return apiRequest<GatewayConfig>('/api/user/payments/gateway/config', {
    query: { channel },
    noDedupe: true,
  });
}

export async function initiateGatewayDeposit(
  input: GatewayInitiateInput
): Promise<GatewayRequest> {
  return apiRequest<GatewayRequest>('/api/user/payments/gateway/deposit', {
    method: 'POST',
    body: input,
  });
}

export async function initiateGatewayWithdrawal(
  input: GatewayInitiateInput
): Promise<GatewayRequest> {
  return apiRequest<GatewayRequest>('/api/user/payments/gateway/withdrawal', {
    method: 'POST',
    body: input,
  });
}

export async function gatewayHistory(
  query: { direction?: 'deposit' | 'withdrawal'; page?: number; limit?: number } = {}
): Promise<{ items: GatewayRequest[]; total: number; page: number; limit: number; pages: number }> {
  return apiRequest('/api/user/payments/gateway/history', {
    query: query as Record<string, string | number | undefined>,
  });
}

export async function cancelGatewayRequest(id: string): Promise<GatewayRequest> {
  return apiRequest<GatewayRequest>(
    `/api/user/payments/gateway/${encodeURIComponent(id)}/cancel`,
    { method: 'DELETE' }
  );
}
