/**
 * Resolves the payment_methods catalogue into the shape the user UI
 * needs, joining DB rows with the live `providerRegistry` so a method
 * tied to a provider that has been disabled in code (e.g. partial
 * outage, feature flag) is hidden even when is_active=true in the DB.
 *
 * Also exposes the tenant-seed helper that seeds Telebirr P2P (and
 * any future default providers) into a freshly-created tenant.
 */

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { loadTelebirrSettings } from '../telebirr/telebirr.settings';
import * as repo from './payment-method.repository';
import { providerRegistry } from './providerRegistry';

export interface PaymentMethodSummary {
  id: string;
  provider_slug: string;
  type: string;
  name: string;
  logo_url: string | null;
  min_amount: string | null;
  max_amount: string | null;
  fee_percent: string;
  fee_fixed: string;
  processing_time_hours: number;
  currencies: string[];
  countries: string[];
  supports_deposit: boolean;
  supports_withdrawal: boolean;
  display_order: number;
  /** Composed at runtime: registry.has(slug) AND tenant settings allow. */
  available: boolean;
  /** When unavailable, why. Empty string when available=true. */
  unavailable_reason: string;
}

export interface ListPaymentMethodsArgs {
  tenantId: string;
  currency?: string | null;
  country?: string | null;
  channel?: 'deposit' | 'withdrawal' | null;
}

export async function listForUser(
  args: ListPaymentMethodsArgs
): Promise<PaymentMethodSummary[]> {
  return withTenantClient({ tenantId: args.tenantId }, async (client) => {
    const rows = await repo.listPaymentMethods(client, {
      tenantId: args.tenantId,
      activeOnly: true,
      currency: args.currency ?? null,
      country: args.country ?? null,
      channel: args.channel ?? null,
    });

    // Pre-load settings for any Telebirr-backed rows so we can apply
    // p2p_enabled / withdrawal_enabled toggles in a single round-trip.
    const needsTelebirr = rows.some((r) => r.provider_slug === 'telebirr_p2p');
    const telebirrSettings = needsTelebirr
      ? await loadTelebirrSettings(client, args.tenantId)
      : null;

    return rows.map((row) => {
      let available = true;
      let unavailableReason = '';

      if (!providerRegistry.has(row.provider_slug)) {
        available = false;
        unavailableReason = 'provider_not_registered';
      } else if (row.provider_slug === 'telebirr_p2p' && telebirrSettings) {
        if (args.channel === 'withdrawal' && !telebirrSettings.withdrawal_enabled) {
          available = false;
          unavailableReason = 'withdrawals_disabled';
        }
        if (args.channel === 'deposit' && !telebirrSettings.p2p_enabled) {
          available = false;
          unavailableReason = 'deposits_disabled';
        }
        if (!args.channel) {
          // No channel filter — show as available unless BOTH are off.
          if (!telebirrSettings.p2p_enabled && !telebirrSettings.withdrawal_enabled) {
            available = false;
            unavailableReason = 'provider_disabled';
          }
        }
      }

      return {
        id: row.id,
        provider_slug: row.provider_slug,
        type: row.type,
        name: row.name,
        logo_url: row.logo_url,
        min_amount: row.min_amount,
        max_amount: row.max_amount,
        fee_percent: row.fee_percent,
        fee_fixed: row.fee_fixed,
        processing_time_hours: row.processing_time_hours,
        currencies: row.currencies,
        countries: row.countries,
        supports_deposit: row.supports_deposit,
        supports_withdrawal: row.supports_withdrawal,
        display_order: row.display_order,
        available,
        unavailable_reason: unavailableReason,
      };
    });
  });
}

/**
 * Idempotent: seeds the default Telebirr P2P payment_methods row for
 * a tenant. Safe to call repeatedly (ON CONFLICT DO NOTHING). Called
 * from:
 *   - admin tenant-create flow (future wiring)
 *   - admin "reset payment methods" action (future wiring)
 *   - manual operator script when migrating a legacy tenant
 *
 * Does not touch existing customised rows; an admin who tweaks the
 * limits or fees will keep their configuration.
 */
export async function seedTelebirrP2PForTenant(
  tenantId: string
): Promise<{ inserted: boolean; provider_slug: 'telebirr_p2p' }> {
  const result = await withTenantClient(
    { tenantId, bypassRls: true },
    async (client) =>
      repo.insertPaymentMethodIfMissing(client, {
        tenantId,
        providerSlug: 'telebirr_p2p',
        type: 'mobile_money',
        name: 'Telebirr P2P',
        logoUrl: '/assets/telebirr-logo.png',
        minAmount: '10',
        maxAmount: '50000',
        feePercent: '0',
        feeFixed: '0',
        processingTimeHours: 0,
        currencies: ['ETB'],
        countries: ['ET'],
        supportsDeposit: true,
        supportsWithdrawal: false,
        isActive: true,
        displayOrder: 1,
        config: {},
      })
  );
  return { inserted: result.inserted, provider_slug: 'telebirr_p2p' };
}
