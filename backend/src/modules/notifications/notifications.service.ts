import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import * as repo from './notifications.repository';
import {
  isSmsEventEnabled,
  loadGeneralConfig,
  type SmsEventCode,
} from '../admin/settings/general-config';

type TemplateVars = Record<string, string | number | boolean | null | undefined>;

/**
 * Maps the legacy `templateCode` strings used throughout the codebase to
 * the spec-defined SMS event codes from Section 19. When the admin
 * disables an event in General Config → SMS Config, every call site
 * that maps to that code is silently skipped.
 */
const TEMPLATE_TO_EVENT: Record<string, SmsEventCode> = {
  // Registration / phone / password
  auth_register_welcome: 'registration_confirmation',
  user_register_success: 'registration_confirmation',
  user_phone_confirm: 'phone_confirmation',
  auth_phone_confirm: 'phone_confirmation',
  auth_password_reset: 'password_reset',
  user_password_reset: 'password_reset',
  // Bet placement
  user_bet_placed: 'bet_placed',
  bet_placed: 'bet_placed',
  bet_for_me_placed: 'bet_for_me_placed',
  // Cancellations
  user_bet_cancelled: 'bet_cancellation',
  bet_cancellation: 'bet_cancellation',
  // Wins
  game_win: 'bet_win',
  user_bet_won: 'bet_win',
  bet_win: 'bet_win',
  // Deposits / withdrawals via cashier
  cashier_deposit_success: 'branch_deposit',
  branch_deposit: 'branch_deposit',
  cashier_withdrawal_success: 'branch_withdrawal',
  branch_withdrawal: 'branch_withdrawal',
  // Online deposit success
  deposit_success: 'deposit_success',
  user_deposit_confirmed: 'deposit_success',
};

interface SendSmsParams {
  tenantId: string;
  to: string | null | undefined;
  /** Either pass `event` for spec-aligned gating, or rely on the
   *  templateCode → event mapping above. */
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

function renderTemplate(input: string, vars: TemplateVars = {}): string {
  return input.replace(/\{([a-zA-Z0-9_]+)\}/g, (_full, key: string) => {
    const v = vars[key];
    return v === null || v === undefined ? '' : String(v);
  });
}

function isSmsEnabled(cfg: repo.SmsProviderConfig | null): boolean {
  if (!cfg) return false;
  if (cfg.features && cfg.features.sms === false) return false;
  return Boolean(cfg.provider && cfg.sender_id);
}

function isEmailEnabled(cfg: repo.SmsProviderConfig | null): boolean {
  if (!cfg) return false;
  return Boolean(cfg.features?.email);
}

async function resolveSmsMessage(
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

export async function sendSmsBestEffort(params: SendSmsParams): Promise<void> {
  const to = params.to?.trim();
  if (!to) return;

  try {
    // Load BOTH provider config (transport credentials + master toggle)
    // and general config (per-event toggles + max-win gate) in one DB
    // session so the gating reflects a consistent snapshot.
    const { providerCfg, generalCfg } = await withTenantClient(
      { tenantId: params.tenantId },
      async (client) => ({
        providerCfg: await repo.getSmsProviderConfig(client, params.tenantId),
        generalCfg: await loadGeneralConfig(client, params.tenantId),
      })
    );

    // Section 19 — per-event SMS gating.
    const eventCode =
      params.event ??
      (params.templateCode ? TEMPLATE_TO_EVENT[params.templateCode] : undefined);
    if (eventCode && !isSmsEventEnabled(generalCfg, eventCode)) {
      logger.info(
        { tenantId: params.tenantId, to, templateCode: params.templateCode, eventCode },
        'sms disabled for this event in general config; skipped'
      );
      return;
    }

    // Section 19 — bet_win threshold: skip notifications for small wins
    // when `sms_max_win_limit` is configured.
    if (
      (eventCode === 'bet_win' || params.templateCode === 'game_win') &&
      generalCfg.sms_max_win_limit > 0 &&
      typeof params.winAmount === 'number' &&
      params.winAmount < generalCfg.sms_max_win_limit
    ) {
      logger.info(
        {
          tenantId: params.tenantId,
          winAmount: params.winAmount,
          threshold: generalCfg.sms_max_win_limit,
        },
        'sms win below threshold; skipped'
      );
      return;
    }

    const message = await resolveSmsMessage(
      params.tenantId,
      params.templateCode,
      params.message,
      params.language,
      params.variables ?? {}
    );
    if (!message) return;

    const cfg = providerCfg;
    if (!isSmsEnabled(cfg)) {
      logger.info(
        { tenantId: params.tenantId, to, templateCode: params.templateCode },
        'sms disabled or provider not configured; skipped'
      );
      return;
    }

    // Stub transport for now. P2.3 requirement is config-driven delivery path.
    logger.info(
      {
        tenantId: params.tenantId,
        provider: cfg?.provider,
        senderId: cfg?.sender_id,
        to,
        apiUrl: cfg?.api_url ?? null,
        templateCode: params.templateCode ?? null,
        message,
      },
      'sms dispatched (transport stub)'
    );
  } catch (err) {
    logger.error({ err, tenantId: params.tenantId, to }, 'sms dispatch failed');
  }
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
