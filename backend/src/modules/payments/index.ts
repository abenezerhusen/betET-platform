/**
 * Public surface of the payment-gateway aggregator.
 *
 * Importing this barrel ALSO has the side-effect of registering the
 * stock providers (currently just TelebirrP2PProvider). Callers can
 * import freely; registry guards against double-register.
 */

import { providerRegistry } from './providerRegistry';
import { telebirrP2PProvider } from './TelebirrP2PProvider';

providerRegistry.register(telebirrP2PProvider);

export { BasePaymentProvider } from './BasePaymentProvider';
export { providerRegistry } from './providerRegistry';
export { TelebirrP2PProvider, telebirrP2PProvider } from './TelebirrP2PProvider';

export {
  listForUser as listPaymentMethodsForUser,
  seedTelebirrP2PForTenant,
  type PaymentMethodSummary,
} from './payment-method.service';

export {
  type CheckDepositStatusResult,
  type InitiateDepositRequest,
  type InitiateDepositResult,
  type InitiateWithdrawalRequest,
  type InitiateWithdrawalResult,
  type InstructionsPayload,
  type PaymentUserContext,
  type WalletMode,
  PaymentProviderError,
} from './types';
