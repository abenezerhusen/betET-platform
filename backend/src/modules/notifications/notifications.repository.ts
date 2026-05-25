import type { PoolClient } from 'pg';

export interface SmsProviderConfig {
  provider?: string;
  sender_id?: string;
  api_url?: string;
  api_key?: string;
  default_language?: string;
  features?: Record<string, boolean>;
}

export interface SmsTemplateRow {
  id: string;
  tenant_id: string;
  code: string;
  name: string;
  body: string;
  language: string;
  is_active: boolean;
}

export async function getSmsProviderConfig(
  client: PoolClient,
  tenantId: string
): Promise<SmsProviderConfig | null> {
  const r = await client.query<{ value: SmsProviderConfig }>(
    `SELECT value
       FROM settings
      WHERE tenant_id = $1
        AND key = 'sms.provider.config'
      LIMIT 1`,
    [tenantId]
  );
  return r.rows[0]?.value ?? null;
}

export async function findSmsTemplate(
  client: PoolClient,
  tenantId: string,
  code: string,
  language?: string
): Promise<SmsTemplateRow | null> {
  if (language) {
    const exact = await client.query<SmsTemplateRow>(
      `SELECT id, tenant_id, code, name, body, language, is_active
         FROM sms_templates
        WHERE tenant_id = $1
          AND code = $2
          AND language = $3
          AND is_active = true
        LIMIT 1`,
      [tenantId, code, language]
    );
    if (exact.rows[0]) return exact.rows[0];
  }

  const fallback = await client.query<SmsTemplateRow>(
    `SELECT id, tenant_id, code, name, body, language, is_active
       FROM sms_templates
      WHERE tenant_id = $1
        AND code = $2
        AND is_active = true
      ORDER BY CASE WHEN language = 'en' THEN 0 ELSE 1 END, updated_at DESC
      LIMIT 1`,
    [tenantId, code]
  );
  return fallback.rows[0] ?? null;
}
