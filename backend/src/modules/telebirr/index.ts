/**
 * Public surface of the Telebirr module.
 *
 * Outside callers (HTTP routes, background workers, tests) should import
 * from this barrel rather than reaching into individual files.
 */

export {
  parseSms,
  normalizePhone,
  parseAmount,
  type ParsedSms,
  type SmsType,
  type ParseConfidence,
} from './telebirr.parser';

export {
  matchPayment,
  confirmManualMatch,
  voidCreditedTransaction,
  type MatchPaymentContext,
  type MatchPaymentResult,
  type MatchOutcome,
  type ConfirmManualMatchInput,
  type ConfirmManualMatchResult,
  type VoidInput,
  type VoidResult,
} from './telebirr.matching.service';

export {
  generateReferenceCode,
  generateUniqueReferenceCode,
  type RefCodeOptions,
} from './telebirr.refcode';

export {
  loadTelebirrSettings,
  getTelebirrSettings,
  TELEBIRR_DEFAULTS,
  TELEBIRR_SETTINGS_KEY,
  type TelebirrSettings,
} from './telebirr.settings';

export {
  TelebirrEvents,
  emitDepositConfirmed,
  emitDepositSuccessful,
  emitNewDeposit,
  type DepositConfirmedPayload,
  type NewDepositPayload,
  type DepositSuccessfulPayload,
} from './telebirr.events';

export {
  initiateTelebirrDeposit,
  getTelebirrDepositStatus,
  type InitiateTelebirrDepositInput,
  type InitiateTelebirrDepositResult,
  type TelebirrDepositStatusResult,
} from './telebirr.deposit-flow';
