/**
 * TelebirrP2PProvider — concrete BasePaymentProvider for Ethiopia
 * Telebirr peer-to-peer deposits and manual withdrawals.
 *
 *   walletMode: 'instructions'
 *     Deposits do not call any external API. The user is shown a
 *     copy-paste set of instructions ("Send X to Y, reference Z") and
 *     the platform's SMS-pay agent devices report the matching
 *     incoming SMS, which our matcher credits the wallet from.
 *
 *   Withdrawals are 'manual' from a money-flow perspective:
 *     A cashier opens the Telebirr app, sends money to the user's
 *     number, and marks the request 'completed' in the cashier UI.
 *     The wallet was already debited at request-time so the user
 *     can't double-spend.
 *
 * The provider does NOT contain any agent-routing or fraud logic
 * directly; it delegates to the existing `telebirr.deposit-flow.ts`
 * helpers and the new `telebirr.withdrawal.service.ts` so the SAME
 * code path runs whether the user hits the legacy
 * `/api/user/deposits/telebirr/initiate` route or the new
 * provider-aggregator route.
 */

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import {
  getTelebirrDepositStatus,
  initiateTelebirrDeposit,
} from '../telebirr/telebirr.deposit-flow';
import * as withdrawalService from '../telebirr/telebirr.withdrawal.service';
import { BasePaymentProvider } from './BasePaymentProvider';
import {
  PaymentProviderError,
  type CheckDepositStatusResult,
  type InitiateDepositRequest,
  type InitiateDepositResult,
  type InitiateWithdrawalRequest,
  type InitiateWithdrawalResult,
  type WalletMode,
} from './types';

const SLUG = 'telebirr_p2p';

export class TelebirrP2PProvider extends BasePaymentProvider {
  getProviderName(): string {
    return SLUG;
  }

  getWalletMode(): WalletMode {
    return 'instructions';
  }

  getSupportedCurrencies(): string[] {
    return ['ETB'];
  }

  getSupportedCountries(): string[] {
    return ['ET'];
  }

  /* ----------------------------------------------------------------------- */
  /* Deposit                                                                  */
  /* ----------------------------------------------------------------------- */

  async initiateDeposit(
    req: InitiateDepositRequest
  ): Promise<InitiateDepositResult> {
    if (req.currency !== 'ETB') {
      throw new PaymentProviderError(
        SLUG,
        'unsupported_currency',
        `Telebirr P2P only supports ETB; got ${req.currency}`,
        { httpStatus: 400 }
      );
    }
    if (req.user.tenantId == null) {
      // Defensive — getUserScope guarantees tenantId, but the provider
      // types allow it to be null in case of future SDK callers.
      throw new PaymentProviderError(SLUG, 'missing_tenant', 'Tenant required', {
        httpStatus: 400,
      });
    }

    const out = await initiateTelebirrDeposit({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      amount: req.amount,
      ip: req.ip ?? null,
      userAgent: req.userAgent ?? null,
    });

    return {
      redirectUrl: null,
      externalRef: out.request_id,
      instructions: {
        summary: out.instructions,
        details: [
          { label: 'Amount', value: `${out.amount} ${out.currency}` },
          { label: 'Telebirr number', value: out.telebirr_number },
          { label: 'Agent', value: out.agent_name },
          { label: 'Reference code', value: out.reference_code },
        ],
        copyFields: [
          { label: 'Telebirr number', value: out.telebirr_number },
          { label: 'Reference code', value: out.reference_code },
          { label: 'Amount', value: out.amount },
        ],
        expiresAt: out.expires_at,
      },
      expiresAt: out.expires_at,
      metadata: {
        agent_id: out.agent_id,
        agent_busy: out.agent_busy,
        reference_code: out.reference_code,
      },
    };
  }

  /**
   * Look up a deposit by externalRef (= telebirr_deposit_requests.id).
   *
   * The BasePaymentProvider contract takes only the externalRef so we
   * resolve the tenant by joining; the lookup is via the public
   * deposit-flow status helper which does its own tenant scoping.
   * Callers that already know the tenant should prefer
   * `getTelebirrDepositStatus` directly to skip the resolve step.
   */
  async checkDepositStatus(
    externalRef: string
  ): Promise<CheckDepositStatusResult> {
    // Resolve the tenant from the request id (public-table read with
    // bypass since we don't yet know the scope). This single point
    // also lets us 404 cleanly when the id is bogus.
    const tenantId = await withTenantClient(
      { tenantId: null, bypassRls: true },
      async (client) => {
        const r = await client.query<{ tenant_id: string }>(
          `SELECT tenant_id FROM telebirr_deposit_requests WHERE id = $1`,
          [externalRef]
        );
        return r.rows[0]?.tenant_id ?? null;
      }
    );
    if (!tenantId) {
      return {
        status: 'unknown',
        completedAt: null,
        externalReference: null,
        amount: null,
        currency: null,
      };
    }

    const status = await getTelebirrDepositStatus({
      tenantId,
      requestId: externalRef,
    });
    if (!status) {
      return {
        status: 'unknown',
        completedAt: null,
        externalReference: null,
        amount: null,
        currency: null,
      };
    }

    const mappedStatus =
      status.status === 'confirmed'
        ? 'completed'
        : status.status === 'waiting'
          ? 'pending'
          : status.status; // 'expired' | 'cancelled'

    // completedAt: only telebirr_transactions has a precise credited_at;
    // we use the request's expires_at proxy only when status='confirmed'
    // and we have a matched_transaction_id. For now leave null and let
    // callers consult the wallet ledger separately when they need
    // exact timing.
    return {
      status: mappedStatus,
      completedAt: null,
      externalReference: status.telebirr_ref,
      amount: status.credited_amount ?? status.amount,
      currency: 'ETB',
      metadata: {
        request_id: status.request_id,
        reference_code: status.reference_code,
        telebirr_number: status.telebirr_number,
        seconds_until_expiry: status.seconds_until_expiry,
        matched_transaction_id: status.matched_transaction_id,
      },
    };
  }

  /* ----------------------------------------------------------------------- */
  /* Withdrawal                                                               */
  /* ----------------------------------------------------------------------- */

  async initiateWithdrawal(
    req: InitiateWithdrawalRequest
  ): Promise<InitiateWithdrawalResult> {
    if (req.currency !== 'ETB') {
      throw new PaymentProviderError(
        SLUG,
        'unsupported_currency',
        `Telebirr P2P only supports ETB; got ${req.currency}`,
        { httpStatus: 400 }
      );
    }

    const details = req.accountDetails;
    const telebirrNumberRaw = (details.telebirrNumber ?? details.telebirr_number) as
      | string
      | undefined;
    const accountName = (details.accountName ?? details.account_name) as
      | string
      | undefined;
    if (!telebirrNumberRaw || typeof telebirrNumberRaw !== 'string') {
      throw new PaymentProviderError(
        SLUG,
        'missing_telebirr_number',
        'accountDetails.telebirrNumber is required',
        { httpStatus: 400 }
      );
    }
    if (!accountName || typeof accountName !== 'string') {
      throw new PaymentProviderError(
        SLUG,
        'missing_account_name',
        'accountDetails.accountName is required',
        { httpStatus: 400 }
      );
    }

    const out = await withdrawalService.initiateWithdrawal({
      tenantId: req.user.tenantId,
      userId: req.user.userId,
      amount: req.amount,
      currency: req.currency,
      telebirrNumber: telebirrNumberRaw,
      accountName,
      ip: req.ip ?? null,
      userAgent: req.userAgent ?? null,
    });

    return {
      externalRef: out.request_id,
      estimatedCompletion: '15-30 minutes during business hours',
      metadata: {
        status: out.status,
        amount: out.amount,
        currency: out.currency,
        telebirr_number: out.telebirr_number,
      },
    };
  }
}

/** Default singleton instance used by `index.ts` to register at boot. */
export const telebirrP2PProvider = new TelebirrP2PProvider();
