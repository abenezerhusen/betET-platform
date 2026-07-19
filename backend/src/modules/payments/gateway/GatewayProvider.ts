/**
 * Generic "Online Payment" gateway provider.
 *
 * One instance is registered per gateway slug (Telebirr, CBE Birr,
 * M-Pesa). Right now it delegates to the gateway service, which creates
 * a pending request (and reserves funds for withdrawals). When a real
 * gateway API is integrated, fill in the network calls here and return a
 * `redirectUrl` / real `externalRef`; the service already persists both.
 *
 * Registering here (in the shared providerRegistry) lets the admin
 * Payment Configuration page list, test and validate these methods just
 * like any other provider.
 */

import { BasePaymentProvider } from '../BasePaymentProvider';
import type {
  InitiateDepositRequest,
  InitiateDepositResult,
  InitiateWithdrawalRequest,
  InitiateWithdrawalResult,
  WalletMode,
} from '../types';
import * as gatewayService from './gateway.service';

export class GatewayProvider extends BasePaymentProvider {
  constructor(
    private readonly slug: string,
    private readonly currencies: string[],
    private readonly countries: string[]
  ) {
    super();
  }

  getProviderName(): string {
    return this.slug;
  }

  // 'redirect' reflects the intended hosted-checkout integration model.
  getWalletMode(): WalletMode {
    return 'redirect';
  }

  getSupportedCurrencies(): string[] {
    return this.currencies;
  }

  getSupportedCountries(): string[] {
    return this.countries;
  }

  async initiateDeposit(
    req: InitiateDepositRequest
  ): Promise<InitiateDepositResult> {
    const out = await gatewayService.initiateGatewayDeposit({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      providerSlug: this.slug,
      amount: req.amount,
      requestedPhone: req.user.phone,
      metadata: req.metadata ?? {},
      ip: req.ip ?? null,
      userAgent: req.userAgent ?? null,
    });
    return {
      redirectUrl: out.redirect_url,
      externalRef: out.id,
      instructions: null,
      expiresAt:
        out.expires_at ?? new Date(Date.now() + 30 * 60_000).toISOString(),
      metadata: { status: out.status, reference: out.reference },
    };
  }

  async initiateWithdrawal(
    req: InitiateWithdrawalRequest
  ): Promise<InitiateWithdrawalResult> {
    const details = req.accountDetails ?? {};
    const phone = (details.phone ??
      details.telebirrNumber ??
      details.telebirr_number ??
      req.user.phone) as string | undefined;
    const out = await gatewayService.initiateGatewayWithdrawal({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      providerSlug: this.slug,
      amount: req.amount,
      requestedPhone: phone ?? null,
      metadata: req.metadata ?? {},
      ip: req.ip ?? null,
      userAgent: req.userAgent ?? null,
    });
    return {
      externalRef: out.id,
      estimatedCompletion: 'Pending gateway settlement',
      metadata: { status: out.status, reference: out.reference },
    };
  }
}
