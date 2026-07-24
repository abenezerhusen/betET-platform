/**
 * TextBee phone-gateway client — ISOLATED from the OTP SMS/Telegram pipeline.
 *
 * TextBee (https://textbee.dev) turns an Android phone into an SMS gateway.
 * This client speaks its REST contract directly and is used ONLY by the
 * admin-controlled Bulk SMS marketing module. It never imports or is imported
 * by the notification/OTP providers, so the two systems stay fully separate.
 *
 * Endpoints (base defaults to https://api.textbee.dev/api/v1):
 *   POST {base}/gateway/devices/{deviceId}/send-sms         → send a message
 *   GET  {base}/gateway/devices/{deviceId}/get-received-sms → connectivity check
 *
 * Auth: `x-api-key: <apiKey>` header.
 *
 * Every function is pure with respect to the DB — callers pass a resolved
 * config so the same client powers "Test Connection", "Send Test SMS" and the
 * background queue worker.
 */

import { logger } from '../../../infrastructure/logger';

const HTTP_TIMEOUT_MS = 15_000;
const DEFAULT_BASE_URL = 'https://api.textbee.dev/api/v1';

export interface TextBeeConfig {
  apiUrl: string;
  apiKey: string;
  deviceId: string;
}

export interface TextBeeResult {
  ok: boolean;
  status: number;
  /** Parsed JSON body when available, otherwise the raw text. */
  response: unknown;
  error?: string;
}

function baseUrl(apiUrl: string | null | undefined): string {
  const u = (apiUrl && apiUrl.trim()) || DEFAULT_BASE_URL;
  return u.replace(/\/+$/, '');
}

async function httpJson(
  method: 'GET' | 'POST',
  url: string,
  apiKey: string,
  body?: Record<string, unknown>
): Promise<TextBeeResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-api-key': apiKey,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text().catch(() => '');
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return {
      ok: res.ok,
      status: res.status,
      response: parsed,
      error: res.ok ? undefined : `gateway_status_${res.status}`,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'gateway_request_failed';
    return { ok: false, status: 0, response: null, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Send a single SMS through the configured TextBee device. */
export async function sendSms(
  config: TextBeeConfig,
  phone: string,
  message: string
): Promise<TextBeeResult> {
  if (!config.apiKey || !config.deviceId) {
    return { ok: false, status: 0, response: null, error: 'gateway_not_configured' };
  }
  const url = `${baseUrl(config.apiUrl)}/gateway/devices/${encodeURIComponent(
    config.deviceId
  )}/send-sms`;
  const result = await httpJson('POST', url, config.apiKey, {
    recipients: [phone],
    message,
  });
  if (!result.ok) {
    logger.warn(
      { deviceId: config.deviceId, status: result.status, error: result.error },
      'textbee: send-sms failed'
    );
  }
  return result;
}

/**
 * Verify connectivity without sending an SMS. TextBee is a self-hosted phone
 * gateway (no wallet balance), and it exposes no plain device-info GET, so we
 * probe the received-SMS endpoint: it returns 200 only when the API key AND
 * device ID are both valid, and 401/404 otherwise. Used by both
 * "Check Balance" and "Test Connection".
 */
export async function checkBalance(config: TextBeeConfig): Promise<TextBeeResult> {
  if (!config.apiKey || !config.deviceId) {
    return { ok: false, status: 0, response: null, error: 'gateway_not_configured' };
  }
  const url = `${baseUrl(config.apiUrl)}/gateway/devices/${encodeURIComponent(
    config.deviceId
  )}/get-received-sms`;
  return httpJson('GET', url, config.apiKey);
}

/** Verify credentials + device reachability without sending an SMS. */
export async function testConnection(config: TextBeeConfig): Promise<TextBeeResult> {
  return checkBalance(config);
}
