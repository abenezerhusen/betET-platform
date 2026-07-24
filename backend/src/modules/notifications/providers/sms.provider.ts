/**
 * SMS notification provider.
 *
 * Config-driven HTTP transport: when the tenant has configured an SMS
 * gateway (api_url + api_key + sender_id), this provider performs a real
 * HTTP POST to the gateway. This keeps the existing SMS behaviour intact
 * for tenants that haven't wired a real endpoint yet — in that case (no
 * api_url) it logs the dispatch instead of failing, exactly like the
 * previous stub, so nothing in the current system breaks.
 *
 * The request shape is intentionally generic (to / from / message + bearer
 * auth) so it works with the majority of HTTP SMS gateways. Gateways with
 * bespoke contracts can be added here behind the `provider` slug without
 * touching any call site.
 */

import { logger } from '../../../infrastructure/logger';
import type { NotificationSettings } from '../notification-config';
import type {
  NotificationProvider,
  ProviderSendParams,
  ProviderSendResult,
} from './types';

const HTTP_TIMEOUT_MS = 10_000;

async function postJson(
  url: string,
  apiKey: string | null,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

export const smsProvider: NotificationProvider = {
  channel: 'sms',

  providerSlug(settings: NotificationSettings): string {
    return settings.sms.provider || 'sms';
  },

  isEnabled(settings: NotificationSettings): boolean {
    return settings.sms.enabled;
  },

  isConfigured(settings: NotificationSettings): boolean {
    return settings.sms.configured;
  },

  async send(params: ProviderSendParams): Promise<ProviderSendResult> {
    const { settings, to, message, tenantId, eventType } = params;
    const sms = settings.sms;
    const slug = this.providerSlug(settings);

    if (!sms.enabled) {
      return { status: 'skipped', provider: slug, error: 'sms_disabled' };
    }

    // No real endpoint configured → preserve legacy stub behaviour so dev /
    // partially-configured tenants keep working without errors.
    if (!sms.api_url) {
      logger.info(
        { tenantId, to, senderId: sms.sender_id, eventType, message },
        'sms dispatched (no api_url configured — transport stub)'
      );
      return { status: 'sent', provider: slug };
    }

    try {
      const { ok, status, text } = await postJson(sms.api_url, sms.api_key, {
        to,
        from: sms.sender_id,
        sender_id: sms.sender_id,
        message,
        text: message,
        // Some gateways expect the key in the body as well as the header.
        api_key: sms.api_key,
      });
      if (!ok) {
        logger.warn(
          { tenantId, to, status, body: text.slice(0, 500), eventType },
          'sms gateway returned non-2xx'
        );
        return {
          status: 'failed',
          provider: slug,
          error: `gateway_status_${status}`,
        };
      }
      return { status: 'sent', provider: slug };
    } catch (err) {
      logger.error({ err, tenantId, to, eventType }, 'sms gateway request failed');
      return {
        status: 'failed',
        provider: slug,
        error: err instanceof Error ? err.message : 'sms_send_error',
      };
    }
  },
};
