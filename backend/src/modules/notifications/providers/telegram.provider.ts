/**
 * Telegram notification provider — real delivery.
 *
 * Two transports are supported, chosen from the tenant config:
 *
 *   1. Telegram Gateway API (gateway.telegram.org) — the official
 *      verification-code service. Used when a `gateway_token` is configured
 *      and the send carries a numeric verification `code` (i.e. an OTP).
 *      Delivers the code to the destination phone number's Telegram account
 *      via POST {api_url}/sendVerificationMessage. This is the path used for
 *      registration / password-reset OTP.
 *
 *   2. Bot API (api.telegram.org) — used when a `bot_token` is configured and
 *      the destination is a numeric Telegram chat id. Sends the rendered
 *      message via {bot base}/bot{token}/sendMessage. This is a best-effort
 *      fallback for non-OTP notifications where a chat id is known.
 *
 * The provider never throws: any missing config, non-OTP-over-gateway, or
 * transport error resolves to a structured skipped/failed result so the
 * notification pipeline (and registration flow) is never broken by Telegram.
 *
 * SECURITY: tokens and verification codes are NEVER written to logs.
 */

import { logger } from '../../../infrastructure/logger';
import { normalizePhone } from '../../admin/bulk-sms/phone';
import type { NotificationSettings } from '../notification-config';
import type {
  NotificationProvider,
  ProviderSendParams,
  ProviderSendResult,
} from './types';

const HTTP_TIMEOUT_MS = 10_000;
const DEFAULT_GATEWAY_BASE_URL = 'https://gatewayapi.telegram.org';
const DEFAULT_BOT_BASE_URL = 'https://api.telegram.org';
const DEFAULT_COUNTRY_CODE = '+251';

/** A Telegram-acceptable verification code: 4–8 digits, numeric only. */
const NUMERIC_CODE = /^\d{4,8}$/;

interface TelegramHttpResult {
  ok: boolean;
  status: number;
  json: Record<string, unknown> | null;
  text: string;
}

async function postJson(
  url: string,
  bearer: string | null,
  body: Record<string, unknown>
): Promise<TelegramHttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    let json: Record<string, unknown> | null = null;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Trim a trailing slash so we can safely append the API path. */
function baseUrl(raw: string | null, fallback: string): string {
  const u = (raw ?? '').trim() || fallback;
  return u.replace(/\/+$/, '');
}

/**
 * Deliver a verification code through the Telegram Gateway API.
 * Endpoint: POST {base}/sendVerificationMessage
 * Auth: Bearer {gateway_token}
 */
async function sendViaGateway(
  params: ProviderSendParams,
  gatewayToken: string,
  code: string
): Promise<ProviderSendResult> {
  const { settings, to, tenantId, eventType } = params;
  const phone = normalizePhone(to, DEFAULT_COUNTRY_CODE);
  if (!phone) {
    logger.warn(
      { tenantId, eventType },
      'telegram gateway: destination is not a valid phone number'
    );
    return {
      status: 'failed',
      provider: 'telegram_gateway',
      error: 'invalid_phone_number',
    };
  }

  const url = `${baseUrl(settings.telegram.api_url, DEFAULT_GATEWAY_BASE_URL)}/sendVerificationMessage`;

  // Optional verified sender username. Only included when configured; the
  // Gateway rejects an unverified/unknown username, so an empty value falls
  // back to the account's default sender.
  const senderUsername = settings.telegram.sender_username;

  try {
    const { ok, status, json } = await postJson(url, gatewayToken, {
      phone_number: phone,
      code,
      ...(senderUsername ? { sender_username: senderUsername } : {}),
    });
    const apiOk = ok && json?.ok === true;
    if (!apiOk) {
      const apiError =
        (json && typeof json.error === 'string' && json.error) ||
        `gateway_status_${status}`;
      logger.warn(
        { tenantId, eventType, status, apiError },
        'telegram gateway send failed'
      );
      return {
        status: 'failed',
        provider: 'telegram_gateway',
        error: apiError,
      };
    }
    logger.info(
      { tenantId, eventType },
      'telegram gateway verification message sent'
    );
    return { status: 'sent', provider: 'telegram_gateway' };
  } catch (err) {
    logger.error(
      { err, tenantId, eventType },
      'telegram gateway request failed'
    );
    return {
      status: 'failed',
      provider: 'telegram_gateway',
      error: err instanceof Error ? err.message : 'gateway_send_error',
    };
  }
}

/**
 * Deliver a plain message through the Telegram Bot API.
 * Endpoint: POST {base}/bot{token}/sendMessage
 * Requires the destination to be a numeric chat id.
 */
async function sendViaBot(
  params: ProviderSendParams,
  botToken: string
): Promise<ProviderSendResult> {
  const { settings, to, message, tenantId, eventType } = params;
  const chatId = to.trim();
  if (!/^-?\d+$/.test(chatId)) {
    // Without a chat id we cannot address a bot message.
    logger.info(
      { tenantId, eventType },
      'telegram bot: destination is not a numeric chat id — skipping'
    );
    return {
      status: 'skipped',
      provider: 'telegram_bot',
      error: 'no_chat_id',
    };
  }

  const url = `${baseUrl(settings.telegram.api_url, DEFAULT_BOT_BASE_URL)}/bot${botToken}/sendMessage`;

  try {
    const { ok, status, json } = await postJson(url, null, {
      chat_id: chatId,
      text: message,
    });
    const apiOk = ok && json?.ok === true;
    if (!apiOk) {
      const apiError =
        (json && typeof json.description === 'string' && json.description) ||
        `bot_status_${status}`;
      logger.warn(
        { tenantId, eventType, status, apiError },
        'telegram bot send failed'
      );
      return { status: 'failed', provider: 'telegram_bot', error: apiError };
    }
    return { status: 'sent', provider: 'telegram_bot' };
  } catch (err) {
    logger.error({ err, tenantId, eventType }, 'telegram bot request failed');
    return {
      status: 'failed',
      provider: 'telegram_bot',
      error: err instanceof Error ? err.message : 'bot_send_error',
    };
  }
}

export const telegramProvider: NotificationProvider = {
  channel: 'telegram',

  providerSlug(): string {
    return 'telegram_gateway';
  },

  isEnabled(settings: NotificationSettings): boolean {
    return settings.telegram.enabled;
  },

  isConfigured(settings: NotificationSettings): boolean {
    return settings.telegram.configured;
  },

  async send(params: ProviderSendParams): Promise<ProviderSendResult> {
    const { settings, tenantId, eventType, code } = params;
    const tg = settings.telegram;

    if (!tg.enabled) {
      return {
        status: 'skipped',
        provider: 'telegram_gateway',
        error: 'telegram_disabled',
      };
    }

    const hasCode = typeof code === 'string' && NUMERIC_CODE.test(code);

    // Preferred: Gateway API for verification codes (OTP).
    if (tg.gateway_token && hasCode) {
      return sendViaGateway(params, tg.gateway_token, code as string);
    }

    // Fallback: Bot API for messages addressed to a chat id.
    if (tg.bot_token) {
      return sendViaBot(params, tg.bot_token);
    }

    // Gateway configured but this isn't an OTP: the Gateway API only delivers
    // verification codes, so non-code events can't be sent this way. Skip
    // gracefully (no crash, no false "sent").
    if (tg.gateway_token && !hasCode) {
      logger.info(
        { tenantId, eventType },
        'telegram gateway: non-verification event cannot be delivered via Gateway — skipping'
      );
      return {
        status: 'skipped',
        provider: 'telegram_gateway',
        error: 'gateway_supports_otp_only',
      };
    }

    // Enabled but no usable credentials.
    logger.warn(
      { tenantId, eventType },
      'telegram enabled but not configured (no gateway_token / bot_token)'
    );
    return {
      status: 'failed',
      provider: 'telegram_gateway',
      error: 'telegram_not_configured',
    };
  },
};
