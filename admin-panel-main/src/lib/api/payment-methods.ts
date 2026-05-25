/** Section 21 — Payment Methods admin API client.
 *
 *  The backend exposes the same CRUD twice:
 *
 *    /api/admin/payment-methods/*
 *    /api/admin/settings/payment/methods/*
 *
 *  Both surfaces hit the same service. The Payment Configuration page
 *  uses the /settings/payment/* alias so it can drop the test endpoint
 *  next to the rest (test lives at POST /payment/:id/test).
 */
import { http } from './client';

export interface ProviderRegistryRow {
  slug: string;
  wallet_mode: string;
  currencies: string[];
  countries: string[];
  supports_deposits: boolean;
  supports_withdrawals: boolean;
}

export interface PaymentMethodRow {
  id: string;
  tenant_id?: string;
  /* Both legacy and spec field names are emitted by the backend so the
   * UI can use whichever it likes. They always carry the same value. */
  provider: string;
  provider_slug: string;
  slug: string;
  provider_registered?: boolean;
  type: string;
  name: string;
  display_name: string;
  logo_url: string | null;
  min_amount: string | null;
  max_amount: string | null;
  fee_percent?: string;
  fee_fixed?: string;
  processing_time_hours?: number;
  currencies: string[];
  countries?: string[];
  supports_deposit: boolean;
  supports_withdrawal: boolean;
  supports_transfer: boolean;
  is_default: boolean;
  channels: string[];
  callback_url: string | null;
  config?: Record<string, unknown>;
  is_active: boolean;
  display_order?: number;
  created_at: string;
  updated_at: string;
}

export interface TestCheck {
  name: string;
  ok: boolean;
  detail?: string;
}
export interface TestResult {
  ok: boolean;
  provider_slug: string;
  checks: TestCheck[];
}

/* ------------------------------------------------------------------------- */
/* List / read                                                                */
/* ------------------------------------------------------------------------- */

export function listPaymentMethods(query: {
  channel?: 'deposit' | 'withdrawal' | 'transfer';
  active_only?: 'true' | 'false';
  currency?: string;
  country?: string;
} = {}) {
  return http.get<{ items: PaymentMethodRow[]; total: number }>(
    '/api/admin/settings/payment/methods',
    { query }
  );
}

export function listPaymentProviders() {
  return http.get<{ items: ProviderRegistryRow[] }>(
    '/api/admin/payment-methods/providers'
  );
}

export function getPaymentMethod(id: string) {
  return http.get<PaymentMethodRow>(`/api/admin/settings/payment/methods/${id}`);
}

/* ------------------------------------------------------------------------- */
/* Mutations                                                                  */
/* ------------------------------------------------------------------------- */

export interface CreatePaymentMethodInput {
  provider_slug: string;
  type?: string;
  name: string;
  logo_url?: string | null;
  min_amount?: string | null;
  max_amount?: string | null;
  fee_percent?: string;
  fee_fixed?: string;
  processing_time_hours?: number;
  currencies?: string[];
  countries?: string[];
  supports_deposit?: boolean;
  supports_withdrawal?: boolean;
  supports_transfer?: boolean;
  is_default?: boolean;
  is_active?: boolean;
  display_order?: number;
  config?: Record<string, unknown>;
}

export function createPaymentMethod(input: CreatePaymentMethodInput) {
  return http.post<PaymentMethodRow>(
    '/api/admin/settings/payment/methods',
    input
  );
}

export interface UpdatePaymentMethodInput {
  name?: string;
  logo_url?: string | null;
  min_amount?: string | null;
  max_amount?: string | null;
  fee_percent?: string;
  fee_fixed?: string;
  processing_time_hours?: number;
  currencies?: string[];
  countries?: string[];
  supports_deposit?: boolean;
  supports_withdrawal?: boolean;
  supports_transfer?: boolean;
  is_default?: boolean;
  is_active?: boolean;
  display_order?: number;
  config?: Record<string, unknown>;
}

export function updatePaymentMethod(id: string, input: UpdatePaymentMethodInput) {
  return http.put<PaymentMethodRow>(
    `/api/admin/settings/payment/methods/${id}`,
    input
  );
}

export function patchPaymentMethod(id: string, input: UpdatePaymentMethodInput) {
  return http.patch<PaymentMethodRow>(
    `/api/admin/settings/payment/methods/${id}`,
    input
  );
}

export function deletePaymentMethod(id: string) {
  return http.delete<{ ok: boolean }>(
    `/api/admin/settings/payment/methods/${id}`
  );
}

export function testPaymentMethod(id: string, overrides?: Record<string, unknown>) {
  return http.post<TestResult>(
    `/api/admin/settings/payment/${id}/test`,
    overrides ? { overrides } : {}
  );
}

export function seedDefaults(input: { tenant_id?: string } = {}) {
  return http.post<{ tenant_id: string; provider_slug: string; inserted: boolean }>(
    '/api/admin/payment-methods/seed-defaults',
    input
  );
}
