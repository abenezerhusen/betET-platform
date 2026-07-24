/**
 * Central notification service.
 *
 * Every outbound user notification in the platform should go through
 * `notify()`. It:
 *   1. Loads the tenant's normalized multi-provider settings.
 *   2. Resolves which channel to use (SMS / Telegram / selected default).
 *   3. Applies per-event gating (General Config → SMS Config toggles) and
 *      the bet-win threshold, preserving existing admin controls.
 *   4. Renders the message (DB template or inline fallback).
 *   5. Dispatches through the resolved provider (config-driven transport).
 *   6. Writes a row to `notification_logs` for delivery tracking.
 *
 * Switching providers therefore never requires call-site changes — callers
 * describe *what* to send; this service decides *how*.
 */

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import * as repo from './notifications.repository';
import {
  loadNotificationSettings,
  resolveChannel,
  type NotificationChannel,
  type NotificationSettings,
} from './notification-config';
import { smsProvider } from './providers/sms.provider';
import { telegramProvider } from './providers/telegram.provider';
import type { NotificationProvider } from './providers/types';
import {
  isSmsEventEnabled,
  loadGeneralConfig,
  type GeneralConfig,
  type SmsEventCode,
} from '../admin/settings/general-config';

export type NotificationCategory =
  | 'auth'
  | 'wallet'
  | 'security'
  | 'system'
  | 'marketing';

/**
 * Canonical notification event catalog (spec Central Notification Service).
 * Values double as the `event_type` stored in notification_logs.
 */
export const NOTIFICATION_EVENTS = {
  // Authentication
  REGISTRATION_OTP: 'registration_otp',
  LOGIN_OTP: 'login_otp',
  FORGOT_PASSWORD_OTP: 'forgot_password_otp',
  // Wallet / transaction
  DEPOSIT_PENDING: 'deposit_pending',
  DEPOSIT_SUCCESSFUL: 'deposit_successful',
  DEPOSIT_FAILED: 'deposit_failed',
  WITHDRAWAL_PENDING: 'withdrawal_pending',
  WITHDRAWAL_APPROVED: 'withdrawal_approved',
  WITHDRAWAL_REJECTED: 'withdrawal_rejected',
  WITHDRAWAL_COMPLETED: 'withdrawal_completed',
  // Security
  PASSWORD_CHANGED: 'password_changed',
  EMAIL_CHANGED: 'email_changed',
  PHONE_CHANGED: 'phone_changed',
  LOGIN_NEW_DEVICE: 'login_new_device',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',
  ACCOUNT_LOCKED: 'account_locked',
  ACCOUNT_UNLOCKED: 'account_unlocked',
  // System
  SYSTEM_MAINTENANCE: 'system_maintenance',
  SYSTEM_ONLINE: 'system_online',
  SYSTEM_OFFLINE: 'system_offline',
  SYSTEM_UPDATE: 'system_update',
  // Marketing
  PROMOTIONAL: 'promotional',
  BULK: 'bulk',
  ADMIN_BROADCAST: 'admin_broadcast',
} as const;

export type NotificationEvent =
  (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];

type TemplateVars = Record<string, string | number | boolean | null | undefined>;

export interface NotifyParams {
  tenantId: string;
  userId?: string | null;
  /** Destination — phone number (SMS) or chat id (Telegram). */
  to: string | null | undefined;
  category: NotificationCategory;
  /** Event key for logging (use NOTIFICATION_EVENTS). */
  event: string;
  /** Channel preference; 'default' uses the resolved default provider. */
  channel?: NotificationChannel | 'default';
  /** DB template code (sms_templates); falls back to `message`. */
  templateCode?: string;
  message?: string;
  language?: string;
  variables?: TemplateVars;
  /** SMS General-Config per-event gate. When omitted it is derived from
   *  the templateCode; pass explicitly to gate non-SMS-mapped events. */
  smsEvent?: SmsEventCode;
  /** bet_win threshold gate. */
  winAmount?: number;
  /** Set false to skip writing a notification_logs row (e.g. bulk sends
   *  that track their own per-recipient rows). Defaults to true. */
  log?: boolean;
  /** Pre-loaded settings snapshot to avoid a second DB round-trip. */
  settings?: NotificationSettings;
}

export interface NotifyResult {
  status: 'sent' | 'failed' | 'skipped';
  channel: NotificationChannel | null;
  provider?: string;
  reason?: string;
}

const PROVIDERS: Record<NotificationChannel, NotificationProvider> = {
  sms: smsProvider,
  telegram: telegramProvider,
};

// Legacy templateCode → SMS event mapping (kept in sync with the historic
// notifications.service map so existing gating behaviour is preserved).
const TEMPLATE_TO_EVENT: Record<string, SmsEventCode> = {
  auth_register_welcome: 'registration_confirmation',
  user_register_success: 'registration_confirmation',
  user_phone_confirm: 'phone_confirmation',
  auth_phone_confirm: 'phone_confirmation',
  auth_password_reset: 'password_reset',
  user_password_reset: 'password_reset',
  user_bet_placed: 'bet_placed',
  bet_placed: 'bet_placed',
  bet_for_me_placed: 'bet_for_me_placed',
  user_bet_cancelled: 'bet_cancellation',
  bet_cancellation: 'bet_cancellation',
  game_win: 'bet_win',
  user_bet_won: 'bet_win',
  bet_win: 'bet_win',
  cashier_deposit_success: 'branch_deposit',
  branch_deposit: 'branch_deposit',
  cashier_withdrawal_success: 'branch_withdrawal',
  branch_withdrawal: 'branch_withdrawal',
  deposit_success: 'deposit_success',
  user_deposit_confirmed: 'deposit_success',
};

export function renderTemplate(input: string, vars: TemplateVars = {}): string {
  return input.replace(/\{([a-zA-Z0-9_]+)\}/g, (_full, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? '' : String(v);
  });
}

/**
 * Core dispatch. Best-effort: never throws. Returns a structured result so
 * callers that care (OTP, bulk) can branch on delivery outcome.
 */
export async function notify(params: NotifyParams): Promise<NotifyResult> {
  const to = params.to?.trim();
  if (!to) return { status: 'skipped', channel: null, reason: 'no_recipient' };

  try {
    // Load settings + general config in one session for a consistent snapshot.
    const { settings, generalCfg } = await withTenantClient(
      { tenantId: params.tenantId },
      async (client): Promise<{
        settings: NotificationSettings;
        generalCfg: GeneralConfig;
      }> => ({
        settings:
          params.settings ??
          (await loadNotificationSettings(params.tenantId, client)),
        generalCfg: await loadGeneralConfig(client, params.tenantId),
      })
    );

    const channel = resolveChannel(settings, params.channel ?? 'default');
    if (!channel) {
      await writeLog(params, {
        channel: params.channel && params.channel !== 'default' ? params.channel : 'none',
        provider: null,
        status: 'skipped',
        error: 'no_provider_enabled',
      });
      return { status: 'skipped', channel: null, reason: 'no_provider_enabled' };
    }

    // Per-event gating (General Config → SMS Config toggles). Applied to the
    // resolved channel so admins keep a single event opt-in surface.
    const eventCode =
      params.smsEvent ??
      (params.templateCode ? TEMPLATE_TO_EVENT[params.templateCode] : undefined);
    if (eventCode && !isSmsEventEnabled(generalCfg, eventCode)) {
      await writeLog(params, {
        channel,
        provider: null,
        status: 'skipped',
        error: `event_disabled:${eventCode}`,
      });
      return { status: 'skipped', channel, reason: 'event_disabled' };
    }

    // bet_win threshold gate.
    if (
      (eventCode === 'bet_win' || params.templateCode === 'game_win') &&
      generalCfg.sms_max_win_limit > 0 &&
      typeof params.winAmount === 'number' &&
      params.winAmount < generalCfg.sms_max_win_limit
    ) {
      await writeLog(params, {
        channel,
        provider: null,
        status: 'skipped',
        error: 'below_win_threshold',
      });
      return { status: 'skipped', channel, reason: 'below_win_threshold' };
    }

    const message = await resolveMessage(
      params.tenantId,
      params.templateCode,
      params.message,
      params.language,
      params.variables ?? {}
    );
    if (!message) {
      return { status: 'skipped', channel, reason: 'empty_message' };
    }

    const provider = PROVIDERS[channel];
    const result = await provider.send({
      tenantId: params.tenantId,
      to,
      message,
      settings,
      eventType: params.event,
    });

    await writeLog(params, {
      channel,
      provider: result.provider,
      status: result.status,
      error: result.error ?? null,
      message,
      sentAt: result.status === 'sent' ? new Date() : null,
    });

    return {
      status: result.status,
      channel,
      provider: result.provider,
      reason: result.error,
    };
  } catch (err) {
    logger.error(
      { err, tenantId: params.tenantId, event: params.event },
      'notification dispatch failed'
    );
    return { status: 'failed', channel: null, reason: 'exception' };
  }
}

async function resolveMessage(
  tenantId: string,
  code: string | undefined,
  fallbackMessage: string | undefined,
  language: string | undefined,
  variables: TemplateVars
): Promise<string | null> {
  if (code) {
    const tpl = await withTenantClient({ tenantId }, async (client) =>
      repo.findSmsTemplate(client, tenantId, code, language)
    );
    if (tpl?.body) return renderTemplate(tpl.body, variables);
  }
  if (fallbackMessage) return renderTemplate(fallbackMessage, variables);
  return null;
}

async function writeLog(
  params: NotifyParams,
  fields: {
    channel: string;
    provider: string | null;
    status: string;
    error?: string | null;
    message?: string;
    sentAt?: Date | null;
  }
): Promise<void> {
  if (params.log === false) return;
  try {
    await withTenantClient({ tenantId: params.tenantId }, async (client) =>
      repo.insertNotificationLog(client, {
        tenantId: params.tenantId,
        userId: params.userId ?? null,
        channel: fields.channel,
        provider: fields.provider,
        category: params.category,
        eventType: params.event,
        recipient: params.to ?? null,
        message: fields.message ?? params.message ?? null,
        status: fields.status,
        error: fields.error ?? null,
        sentAt: fields.sentAt ?? null,
      })
    );
  } catch (err) {
    logger.error({ err, tenantId: params.tenantId }, 'failed to write notification log');
  }
}
