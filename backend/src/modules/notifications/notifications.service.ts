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

import nodemailer, { type Transporter } from 'nodemailer';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import { env } from '../../config/env';
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
  /** Optional HTML alternative. Falls back to a <pre> of `body` when omitted. */
  html?: string;
}

/**
 * Lazily-created SMTP transport. Real email is sent only when SMTP_HOST is
 * configured; otherwise callers fall back to the dev log stub. Cached so we
 * don't rebuild a connection pool on every send.
 */
let mailTransport: Transporter | null = null;
function getMailTransport(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (mailTransport) return mailTransport;
  mailTransport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth:
      env.SMTP_USER && env.SMTP_PASS
        ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
        : undefined,
  });
  return mailTransport;
}

function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST);
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
    // Production path: when an SMTP server is configured, security /
    // transactional emails (e.g. admin password reset) are always sent —
    // independent of the tenant's marketing email toggle, since blocking a
    // password-reset email would lock admins out of their own accounts.
    const transport = getMailTransport();
    if (transport) {
      await transport.sendMail({
        from: env.EMAIL_FROM,
        to,
        subject: params.subject,
        text: params.body,
        html:
          params.html ??
          `<pre style="font-family:inherit;white-space:pre-wrap">${params.body}</pre>`,
      });
      logger.info(
        { tenantId: params.tenantId, to, subject: params.subject },
        'email sent via SMTP'
      );
      return;
    }

    // Dev / no-SMTP fallback: respect the tenant toggle and log-only stub so
    // local development keeps working without a mail server configured.
    const cfg = await withTenantClient({ tenantId: params.tenantId }, async (client) =>
      repo.getSmsProviderConfig(client, params.tenantId)
    );
    if (!isEmailEnabled(cfg)) {
      logger.info(
        { tenantId: params.tenantId, to, subject: params.subject },
        'email skipped: no SMTP configured and tenant email feature disabled'
      );
      return;
    }
    logger.info(
      { tenantId: params.tenantId, to, subject: params.subject, body: params.body },
      'email dispatched (dev log stub — configure SMTP_HOST for real delivery)'
    );
  } catch (err) {
    logger.error({ err, tenantId: params.tenantId, to }, 'email dispatch failed');
  }
}

/** Whether real (SMTP) email delivery is available in this environment. */
export function emailDeliveryConfigured(): boolean {
  return isSmtpConfigured();
}
