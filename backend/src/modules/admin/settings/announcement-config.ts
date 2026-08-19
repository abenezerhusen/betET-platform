/**
 * Announcement Popup — the promo/welcome modal shown on the user-panel
 * home page when the operator enables it (Settings → General →
 * Announcement Popup). Stored as a single JSONB row under
 * `general.announcement`, mirroring the maintenance/footer blocks.
 *
 * The popup is a purely additive, opt-in feature: `enabled` defaults to
 * false so nothing shows until the admin turns it on. It is used to
 * promote today's bonus, a jackpot/tournament, a warning/notice, etc.
 */

import type { PoolClient } from 'pg';

export const ANNOUNCEMENT_CONFIG_KEY = 'general.announcement';

/** How often the popup re-appears for the same visitor's browser. */
export type AnnouncementFrequency = 'always' | 'session' | 'daily';

export interface AnnouncementConfig {
  /** Master on/off toggle. When false the popup never shows. */
  enabled: boolean;
  title: string;
  message: string;
  /** Optional image/banner shown above the text (URL or base64 data URL). */
  image_url: string;
  /** Optional call-to-action button label (empty hides the button). */
  button_text: string;
  /** Optional button link. Empty = the button just closes the popup. */
  button_url: string;
  /** always | session | daily (how often it re-shows per browser). */
  frequency: AnnouncementFrequency;
}

const FREQUENCIES: readonly AnnouncementFrequency[] = ['always', 'session', 'daily'];

export function normalizeAnnouncementConfig(raw: unknown): AnnouncementConfig {
  const v = (raw ?? {}) as Record<string, unknown>;
  const freq = typeof v.frequency === 'string' && FREQUENCIES.includes(v.frequency as AnnouncementFrequency)
    ? (v.frequency as AnnouncementFrequency)
    : 'session';
  const str = (x: unknown): string => (typeof x === 'string' ? x : '');
  return {
    enabled: Boolean(v.enabled),
    title: str(v.title),
    message: str(v.message),
    image_url: str(v.image_url),
    button_text: str(v.button_text),
    button_url: str(v.button_url),
    frequency: freq,
  };
}

export async function loadAnnouncementConfig(
  client: PoolClient,
  tenantId: string
): Promise<AnnouncementConfig> {
  const r = await client.query<{ value: unknown }>(
    `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2 LIMIT 1`,
    [tenantId, ANNOUNCEMENT_CONFIG_KEY]
  );
  return normalizeAnnouncementConfig(r.rows[0]?.value);
}
