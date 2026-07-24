/**
 * Security notification helper. Best-effort wrapper around the central
 * notification service for account-security events. Resolves the user's
 * phone and sends through the active provider. Never throws.
 */

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import { notify, NOTIFICATION_EVENTS } from './notification.service';

export type SecurityNotificationEvent =
  | 'password_changed'
  | 'email_changed'
  | 'phone_changed'
  | 'login_new_device'
  | 'suspicious_activity'
  | 'account_locked'
  | 'account_unlocked';

const EVENT_KEY: Record<SecurityNotificationEvent, string> = {
  password_changed: NOTIFICATION_EVENTS.PASSWORD_CHANGED,
  email_changed: NOTIFICATION_EVENTS.EMAIL_CHANGED,
  phone_changed: NOTIFICATION_EVENTS.PHONE_CHANGED,
  login_new_device: NOTIFICATION_EVENTS.LOGIN_NEW_DEVICE,
  suspicious_activity: NOTIFICATION_EVENTS.SUSPICIOUS_ACTIVITY,
  account_locked: NOTIFICATION_EVENTS.ACCOUNT_LOCKED,
  account_unlocked: NOTIFICATION_EVENTS.ACCOUNT_UNLOCKED,
};

const TEMPLATE_KEY: Record<SecurityNotificationEvent, string> = {
  password_changed: 'security_password_changed',
  email_changed: 'security_email_changed',
  phone_changed: 'security_phone_changed',
  login_new_device: 'security_login_new_device',
  suspicious_activity: 'security_suspicious_activity',
  account_locked: 'security_account_locked',
  account_unlocked: 'security_account_unlocked',
};

const DEFAULT_MESSAGE: Record<SecurityNotificationEvent, string> = {
  password_changed:
    'Your password was changed. If this was not you, contact support immediately.',
  email_changed: 'The email on your account was changed.',
  phone_changed: 'The phone number on your account was changed.',
  login_new_device: 'A new sign-in to your account was detected.',
  suspicious_activity: 'Suspicious activity was detected on your account.',
  account_locked: 'Your account has been locked. Contact support for assistance.',
  account_unlocked: 'Your account has been unlocked. You can sign in again.',
};

export interface SecurityNotifyParams {
  tenantId: string;
  userId: string;
  event: SecurityNotificationEvent;
  to?: string | null;
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

export async function notifySecurityEvent(
  params: SecurityNotifyParams
): Promise<void> {
  try {
    const to = params.to ?? (await resolvePhone(params.tenantId, params.userId));
    if (!to) return;
    await notify({
      tenantId: params.tenantId,
      userId: params.userId,
      to,
      category: 'security',
      event: EVENT_KEY[params.event],
      channel: 'default',
      templateCode: TEMPLATE_KEY[params.event],
      message: DEFAULT_MESSAGE[params.event],
      variables: params.variables,
    });
  } catch (err) {
    logger.error(
      { err, tenantId: params.tenantId, event: params.event },
      'security notification failed'
    );
  }
}
