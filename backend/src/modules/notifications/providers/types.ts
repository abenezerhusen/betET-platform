/**
 * Provider abstraction for the notification system. Each channel (SMS,
 * Telegram Gateway, and any future channel) implements this interface so
 * the central notification service can dispatch without knowing transport
 * details. Switching the active provider is therefore a config change, not
 * a code change.
 */

import type { NotificationSettings } from '../notification-config';

export interface ProviderSendParams {
  tenantId: string;
  /** Destination address — phone number (SMS) or chat id (Telegram). */
  to: string;
  message: string;
  /** Normalized settings snapshot for this tenant. */
  settings: NotificationSettings;
  /** Optional event key for logging/telemetry. */
  eventType?: string;
}

export interface ProviderSendResult {
  status: 'sent' | 'failed' | 'skipped';
  provider: string;
  error?: string;
}

export interface NotificationProvider {
  /** Channel key: 'sms' | 'telegram'. */
  readonly channel: 'sms' | 'telegram';
  /** Human/telemetry slug of the concrete provider. */
  providerSlug(settings: NotificationSettings): string;
  /** True when this channel is enabled for the tenant. */
  isEnabled(settings: NotificationSettings): boolean;
  /** True when the channel has enough config to actually transmit. */
  isConfigured(settings: NotificationSettings): boolean;
  send(params: ProviderSendParams): Promise<ProviderSendResult>;
}
