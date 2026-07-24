/**
 * Wallet / transaction notification helper.
 *
 * A thin, best-effort wrapper around the central notification service for
 * deposit and withdrawal lifecycle events. It resolves the recipient phone
 * (either passed in or looked up) and sends through the tenant's active
 * provider. Never throws — a notification failure must never reverse or
 * block a financial transaction.
 */

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import { notify, NOTIFICATION_EVENTS } from './notification.service';

export type WalletNotificationEvent =
  | 'deposit_pending'
  | 'deposit_successful'
  | 'deposit_failed'
  | 'withdrawal_pending'
  | 'withdrawal_approved'
  | 'withdrawal_rejected'
  | 'withdrawal_completed';

const EVENT_KEY: Record<WalletNotificationEvent, string> = {
  deposit_pending: NOTIFICATION_EVENTS.DEPOSIT_PENDING,
  deposit_successful: NOTIFICATION_EVENTS.DEPOSIT_SUCCESSFUL,
  deposit_failed: NOTIFICATION_EVENTS.DEPOSIT_FAILED,
  withdrawal_pending: NOTIFICATION_EVENTS.WITHDRAWAL_PENDING,
  withdrawal_approved: NOTIFICATION_EVENTS.WITHDRAWAL_APPROVED,
  withdrawal_rejected: NOTIFICATION_EVENTS.WITHDRAWAL_REJECTED,
  withdrawal_completed: NOTIFICATION_EVENTS.WITHDRAWAL_COMPLETED,
};

const TEMPLATE_KEY: Record<WalletNotificationEvent, string> = {
  deposit_pending: 'wallet_deposit_pending',
  deposit_successful: 'wallet_deposit_successful',
  deposit_failed: 'wallet_deposit_failed',
  withdrawal_pending: 'wallet_withdrawal_pending',
  withdrawal_approved: 'wallet_withdrawal_approved',
  withdrawal_rejected: 'wallet_withdrawal_rejected',
  withdrawal_completed: 'wallet_withdrawal_completed',
};

const DEFAULT_MESSAGE: Record<WalletNotificationEvent, string> = {
  deposit_pending:
    'Your deposit of {currency} {amount} is being processed. We will notify you once it is confirmed.',
  deposit_successful:
    '{currency} {amount} has been credited to your wallet. New balance: {currency} {balance}.',
  deposit_failed:
    'Your deposit of {currency} {amount} could not be completed. Please try again.',
  withdrawal_pending:
    'Your withdrawal request of {currency} {amount} has been received and is pending review.',
  withdrawal_approved:
    'Your withdrawal of {currency} {amount} has been approved and is being processed.',
  withdrawal_rejected:
    'Your withdrawal of {currency} {amount} was rejected. The amount has been returned to your wallet.',
  withdrawal_completed:
    'Your withdrawal of {currency} {amount} has been completed successfully.',
};

export interface WalletNotifyParams {
  tenantId: string;
  userId: string;
  event: WalletNotificationEvent;
  amount?: string | number | null;
  currency?: string | null;
  /** Recipient phone. Looked up from the user row when omitted. */
  to?: string | null;
  /** Extra template variables (e.g. balance, reference). */
  variables?: Record<string, string | number | null | undefined>;
}

async function resolvePhone(
  tenantId: string,
  userId: string
): Promise<string | null> {
  return withTenantClient({ tenantId }, async (client) => {
    const r = await client.query<{ phone: string | null }>(
      `SELECT phone FROM users WHERE id = $1 LIMIT 1`,
      [userId]
    );
    return r.rows[0]?.phone ?? null;
  });
}

export async function notifyWalletEvent(
  params: WalletNotifyParams
): Promise<void> {
  try {
    const to = params.to ?? (await resolvePhone(params.tenantId, params.userId));
    if (!to) return;
    await notify({
      tenantId: params.tenantId,
      userId: params.userId,
      to,
      category: 'wallet',
      event: EVENT_KEY[params.event],
      channel: 'default',
      templateCode: TEMPLATE_KEY[params.event],
      message: DEFAULT_MESSAGE[params.event],
      variables: {
        amount: params.amount ?? '',
        currency: params.currency ?? 'ETB',
        ...(params.variables ?? {}),
      },
    });
  } catch (err) {
    logger.error(
      { err, tenantId: params.tenantId, event: params.event },
      'wallet notification failed'
    );
  }
}
