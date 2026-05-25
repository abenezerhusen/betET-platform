import {
  emitToCashiers,
  emitToAdmins,
  emitToUser,
} from '../../realtime/socket';

/**
 * Telebirr-specific socket events. Kept in the module rather than in the
 * shared `realtime/socket.ts` Events catalog so that the event vocabulary
 * stays close to the feature that owns it.
 *
 * Wire format mirrors the existing UPPER_SNAKE_CASE convention.
 */
export const TelebirrEvents = {
  /** Sent to the player's personal room when their deposit is credited. */
  DEPOSIT_CONFIRMED: 'DEPOSIT_CONFIRMED',
  /**
   * Sent to cashier + admin rooms whenever a Telebirr deposit lands —
   * matched, unmatched, or ambiguous. Cashiers use it to drive the
   * deposit queue UI.
   */
  NEW_DEPOSIT: 'NEW_DEPOSIT',
  /**
   * Player-facing notification stream (toast / inbox). Reuses the
   * generic PUSH_NOTIFICATION channel so the user-panel notification
   * widget can render it without a per-feature subscription.
   */
  DEPOSIT_SUCCESSFUL: 'DEPOSIT_SUCCESSFUL',
} as const;

export interface DepositConfirmedPayload {
  amount: string;
  currency: string;
  telebirr_ref: string;
  telebirr_transaction_id: string;
  wallet_balance: string;
}

export function emitDepositConfirmed(
  tenantId: string,
  userId: string,
  payload: DepositConfirmedPayload
): void {
  emitToUser(tenantId, userId, TelebirrEvents.DEPOSIT_CONFIRMED, payload);
}

export interface NewDepositPayload {
  telebirr_transaction_id: string;
  user_id: string | null;
  user_phone: string | null;
  amount: string;
  currency: string;
  method: 'telebirr';
  status: 'credited' | 'unmatched' | 'probable_match' | 'ambiguous';
  sender_phone: string | null;
  sender_name: string | null;
  telebirr_ref: string;
  created_at: string;
}

export function emitNewDeposit(
  tenantId: string,
  payload: NewDepositPayload
): void {
  emitToCashiers(tenantId, TelebirrEvents.NEW_DEPOSIT, payload);
  // Mirror to admins for monitoring (matches the NEW_WITHDRAWAL pattern).
  emitToAdmins(tenantId, TelebirrEvents.NEW_DEPOSIT, payload);
  // Legacy admin listeners (mobile/admin P2P integration prompt) expect this
  // lower-case namespace.
  emitToAdmins(tenantId, 'p2p:new_deposit', payload);
}

export interface DepositSuccessfulPayload {
  amount: string;
  currency: string;
  telebirr_ref: string;
  message: string;
}

export function emitDepositSuccessful(
  tenantId: string,
  userId: string,
  payload: DepositSuccessfulPayload
): void {
  emitToUser(tenantId, userId, TelebirrEvents.DEPOSIT_SUCCESSFUL, payload);
}
