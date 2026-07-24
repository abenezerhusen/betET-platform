/**
 * Backwards-compatible SMS/email helpers.
 *
 * Historically the whole platform called `sendSmsBestEffort()` directly.
 * Those call sites are preserved verbatim, but the implementation now
 * delegates to the central `notify()` service, which routes through the
 * tenant's active provider (SMS or Telegram Gateway) and records a delivery
 * log. This means every existing SMS call site automatically respects the
 * new Enable/Disable toggles and provider selection with zero changes at
 * the call site.
 *
 * `sendEmailBestEffort()` keeps its original stub behaviour — email is out
 * of scope for the multi-provider work.
 */

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import * as repo from './notifications.repository';
import { normalizeNotificationSettings } from './notification-config';
import {
  notify,
  type NotificationCategory,
} from './notification.service';
import type { SmsEventCode } from '../admin/settings/general-config';

type TemplateVars = Record<string, string | number | boolean | null | undefined>;

interface SendSmsParams {
  tenantId: string;
  to: string | null | undefined;
  /** Either pass `event` for spec-aligned gating, or rely on the
   *  templateCode → event mapping in the central service. */
  event?: SmsEventCode;
  templateCode?: string;
  message?: string;
  language?: string;
  variables?: TemplateVars;
  /** For bet_win events: skips SMS when payout is below the admin's
   *  `sms_max_win_limit` (0 disables the gate, default). */
  winAmount?: number;
}

interface SendEmailParams {
  tenantId: string;
  to: string | null | undefined;
  subject: string;
  body: string;
}

/** Infer a log category from the legacy SMS event/template code. */
function categoryFor(code: string | undefined): NotificationCategory {
  if (!code) return 'system';
  if (
    code.startsWith('registration') ||
    code.includes('password') ||
    code.includes('phone_confirm') ||
    code.includes('register')
  ) {
    return 'auth';
  }
  if (code.includes('deposit') || code.includes('withdrawal')) return 'wallet';
  return 'system';
}

/**
 * Best-effort notification send, preserved for legacy call sites. Routes
 * through the central notification service using the tenant's default
 * provider so SMS/Telegram selection and the Enable/Disable toggle are
 * honoured everywhere.
 */
export async function sendSmsBestEffort(params: SendSmsParams): Promise<void> {
  const code = params.event ?? params.templateCode;
  await notify({
    tenantId: params.tenantId,
    to: params.to,
    category: categoryFor(code),
    event: params.templateCode ?? params.event ?? 'legacy_sms',
    channel: 'default',
    templateCode: params.templateCode,
    message: params.message,
    language: params.language,
    variables: params.variables,
    smsEvent: params.event,
    winAmount: params.winAmount,
  });
}

function isEmailEnabled(cfg: repo.SmsProviderConfig | null): boolean {
  if (!cfg) return false;
  return Boolean(normalizeNotificationSettings(cfg).emailEnabled);
}

export async function sendEmailBestEffort(params: SendEmailParams): Promise<void> {
  const to = params.to?.trim();
  if (!to) return;

  try {
    const cfg = await withTenantClient({ tenantId: params.tenantId }, async (client) =>
      repo.getSmsProviderConfig(client, params.tenantId)
    );
    if (!isEmailEnabled(cfg)) {
      logger.info(
        { tenantId: params.tenantId, to, subject: params.subject },
        'email disabled in sms.provider.config.features.email; skipped'
      );
      return;
    }

    // Stub transport for now; can be replaced with SMTP/provider integration.
    logger.info(
      { tenantId: params.tenantId, to, subject: params.subject, body: params.body },
      'email dispatched (transport stub)'
    );
  } catch (err) {
    logger.error({ err, tenantId: params.tenantId, to }, 'email dispatch failed');
  }
}
