/**
 * Telegram Gateway notification provider.
 *
 * IMPORTANT: per the current requirements, this provider is prepared but
 * does NOT call any Telegram API yet. The transport is a clearly-marked
 * stub that logs the dispatch. All credentials (bot token, gateway token,
 * chat config, api url) are read from the tenant config so that, once the
 * real integration is dropped into `transmit()`, enabling the toggle and
 * adding credentials is enough — no call site changes are required.
 *
 * When Telegram is enabled but not fully configured, the send is treated
 * as "sent (stub)" rather than failing, so provider selection logic can be
 * exercised end-to-end before real credentials exist.
 */

import { logger } from '../../../infrastructure/logger';
import type { NotificationSettings } from '../notification-config';
import type {
  NotificationProvider,
  ProviderSendParams,
  ProviderSendResult,
} from './types';

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
    const { settings, to, message, tenantId, eventType } = params;
    const tg = settings.telegram;

    if (!tg.enabled) {
      return {
        status: 'skipped',
        provider: 'telegram_gateway',
        error: 'telegram_disabled',
      };
    }

    // Transport stub — Telegram API integration is intentionally deferred.
    // This block is the single place to implement real delivery later.
    logger.info(
      {
        tenantId,
        to,
        eventType,
        hasBotToken: Boolean(tg.bot_token),
        hasGatewayToken: Boolean(tg.gateway_token),
        apiUrl: tg.api_url ?? null,
        message,
      },
      'telegram dispatched (transport stub — integration pending)'
    );
    return { status: 'sent', provider: 'telegram_gateway' };
  },
};
