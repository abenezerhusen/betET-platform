import type {
  CheckDepositStatusResult,
  InitiateDepositRequest,
  InitiateDepositResult,
  InitiateWithdrawalRequest,
  InitiateWithdrawalResult,
  WalletMode,
} from './types';

/**
 * Every payment integration extends this abstract class and registers
 * itself with `providerRegistry.register(new MyProvider())`.
 *
 * Methods that aren't supported throw the standard "Method not
 * implemented" error so the registry can introspect capabilities at
 * runtime via `supportsDeposits` / `supportsWithdrawals` getters.
 */
export abstract class BasePaymentProvider {
  /** Stable slug used as the foreign key in payment_methods.
   *  Must match `[a-z0-9_]+`, must be unique across all providers. */
  abstract getProviderName(): string;

  /** How the platform interacts with the provider. */
  abstract getWalletMode(): WalletMode;

  /** ISO-4217 currency codes the provider supports across all tenants
   *  (per-tenant subset is configured in `payment_methods.currencies`). */
  abstract getSupportedCurrencies(): string[];

  /** ISO-3166 alpha-2 country codes the provider supports. */
  abstract getSupportedCountries(): string[];

  /**
   * Capability flags. Default to runtime-detected (an override exists
   * iff the subclass overrode the method). Subclasses may override to
   * hard-code true/false when an integration is half-implemented.
   */
  supportsDeposits(): boolean {
    return this.initiateDeposit !== BasePaymentProvider.prototype.initiateDeposit;
  }
  supportsWithdrawals(): boolean {
    return (
      this.initiateWithdrawal !==
      BasePaymentProvider.prototype.initiateWithdrawal
    );
  }

  /* ----------------------------------------------------------------------- */
  /* Default-throwing capabilities — subclasses override                      */
  /* ----------------------------------------------------------------------- */

  /**
   * Begin a deposit. Returns either a redirect URL (Chapa, Stripe…) or
   * an instructions payload (Telebirr P2P).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async initiateDeposit(_req: InitiateDepositRequest): Promise<InitiateDepositResult> {
    throw new Error(
      `${this.getProviderName()} does not implement initiateDeposit`
    );
  }

  /**
   * Resolve the live status of a deposit by its external reference.
   * For internal/instructions providers this typically reads our own
   * DB; for redirect providers it polls the upstream API.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async checkDepositStatus(_externalRef: string): Promise<CheckDepositStatusResult> {
    throw new Error(
      `${this.getProviderName()} does not implement checkDepositStatus`
    );
  }

  /**
   * Begin a withdrawal. Returns the platform-side reference + ETA. The
   * actual money movement may happen synchronously (auto-settled
   * providers) or asynchronously (cashier-processed Telebirr P2P).
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async initiateWithdrawal(
    _req: InitiateWithdrawalRequest
  ): Promise<InitiateWithdrawalResult> {
    throw new Error(
      `${this.getProviderName()} does not implement initiateWithdrawal`
    );
  }
}
