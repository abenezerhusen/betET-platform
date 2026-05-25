/**
 * Shared types used across the payment-gateway aggregator.
 *
 * All providers — present and future — speak this dialect:
 *   - request shapes are normalised here, NOT per-provider
 *   - responses follow a discriminated-union pattern so the caller
 *     does not need to care whether a redirect is involved
 *   - currency is ISO-4217, country is ISO-3166 alpha-2
 */

/* ------------------------------------------------------------------------- */
/* Provider metadata                                                         */
/* ------------------------------------------------------------------------- */

/**
 * 'redirect'      – initiateDeposit returns a URL the user is sent to
 *                   (Chapa, Telebirr OAuth, Stripe Checkout, etc.).
 * 'instructions'  – initiateDeposit returns text instructions the user
 *                   follows manually (Telebirr P2P: "send X to Y with
 *                   reference Z"). No redirect.
 * 'internal'      – everything happens server-side; the provider does
 *                   not call any external API at all (e.g. cashier
 *                   counter deposits, internal transfers, Telebirr P2P
 *                   from the platform's perspective once the SMS-based
 *                   matcher takes over).
 */
export type WalletMode = 'redirect' | 'instructions' | 'internal';

/* ------------------------------------------------------------------------- */
/* User context passed to every provider call                                 */
/* ------------------------------------------------------------------------- */

/**
 * Minimal user shape providers need. Deliberately narrow so we do not
 * leak unrelated user fields into provider-specific HTTP payloads.
 */
export interface PaymentUserContext {
  tenantId: string;
  userId: string;
  /** Canonical 0XXXXXXXXX (when known) — used to suggest defaults in
   *  the deposit instructions UI. */
  phone: string | null;
  email: string | null;
  /** Currency code of the user's wallet. */
  currency: string;
  /** Country of operation; defaults to the tenant default (ET). */
  country: string;
}

/* ------------------------------------------------------------------------- */
/* Deposit                                                                   */
/* ------------------------------------------------------------------------- */

export interface InitiateDepositRequest {
  user: PaymentUserContext;
  /** Decimal string (e.g. '500.00'). */
  amount: string;
  currency: string;
  /** Where the user is sent on completion when the provider supports
   *  redirect-based flows. Ignored by 'instructions' / 'internal'
   *  providers. */
  returnUrl?: string | null;
  /** Free-form caller metadata stored alongside the deposit (for audit
   *  / client-side reconciliation). */
  metadata?: Record<string, unknown>;
  /** Forwarded from the originating Express request so the provider
   *  can capture IP/UA when needed for fraud rules (RULE 8 etc.). */
  ip?: string | null;
  userAgent?: string | null;
}

export interface InstructionsPayload {
  /** Single-line summary shown above the details (e.g. 'Send ETB 500…'). */
  summary: string;
  /** Key/value detail pairs the UI renders as a list (label → value). */
  details: Array<{ label: string; value: string }>;
  /** ISO-8601 timestamp the request expires at. The UI counts down to
   *  this value. */
  expiresAt: string;
  /** Optional copy-to-clipboard fields (number, reference, etc.). */
  copyFields?: Array<{ label: string; value: string }>;
}

/**
 * Result of initiating a deposit. Always returns the same envelope so
 * the caller can switch on `redirectUrl !== null`.
 *
 *   - When redirectUrl is set, the user is navigated to that URL.
 *   - When instructions is set, the UI renders a payment-instructions
 *     screen (with copyable fields, countdown timer, etc.).
 *   - externalRef is the provider-specific identifier (request id,
 *     payment intent id, …) the caller passes to checkDepositStatus.
 *   - expiresAt is convenience copy of instructions.expiresAt for
 *     redirect-style providers that have their own expiry.
 */
export interface InitiateDepositResult {
  redirectUrl: string | null;
  externalRef: string;
  instructions: InstructionsPayload | null;
  expiresAt: string;
  /** Free-form data the caller can stash in the local DB (provider
   *  metadata: payment intent id, agent assignment, etc.). */
  metadata?: Record<string, unknown>;
}

export interface CheckDepositStatusResult {
  /** 'pending'   – not credited yet, still waiting on user action
   *  'completed' – credited; wallet was updated
   *  'expired'   – aged out without payment
   *  'failed'    – provider explicitly returned a terminal failure
   *  'cancelled' – user cancelled before payment
   *  'unknown'   – the provider returned an unrecognised state */
  status:
    | 'pending'
    | 'completed'
    | 'expired'
    | 'failed'
    | 'cancelled'
    | 'unknown';
  /** ISO-8601 when the provider considers the payment finalised. */
  completedAt: string | null;
  /** Provider-side reference (e.g. Telebirr SMS ref) when the deposit
   *  has been credited. Null until then. */
  externalReference: string | null;
  /** Decimal string of credited amount, when known. */
  amount: string | null;
  currency: string | null;
  metadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------------- */
/* Withdrawal                                                                */
/* ------------------------------------------------------------------------- */

export interface InitiateWithdrawalRequest {
  user: PaymentUserContext;
  amount: string;
  currency: string;
  /** Provider-specific account details. Each provider validates the
   *  shape it cares about — TelebirrP2PProvider requires
   *  { telebirrNumber, accountName }. */
  accountDetails: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

export interface InitiateWithdrawalResult {
  externalRef: string;
  /** Human-readable ETA. The UI displays this verbatim. */
  estimatedCompletion: string;
  /** When the provider can give an actual SLA. */
  estimatedCompletionAt?: string | null;
  /** When set, providers can hint at the URL where the user can track
   *  the withdrawal status. */
  trackingUrl?: string | null;
  metadata?: Record<string, unknown>;
}

/* ------------------------------------------------------------------------- */
/* Errors                                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Providers throw these when the failure is normative (e.g. user is
 * over their daily cap, no agent available, amount out of range).
 * The HTTP layer converts them to typed responses.
 */
export class PaymentProviderError extends Error {
  public readonly providerSlug: string;
  public readonly code: string;
  public readonly httpStatus: number;
  public readonly details?: unknown;

  constructor(
    providerSlug: string,
    code: string,
    message: string,
    options: { httpStatus?: number; details?: unknown } = {}
  ) {
    super(message);
    this.name = 'PaymentProviderError';
    this.providerSlug = providerSlug;
    this.code = code;
    this.httpStatus = options.httpStatus ?? 400;
    this.details = options.details;
  }
}
