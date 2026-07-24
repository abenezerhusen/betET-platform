/**
 * Bulk SMS Marketing module (isolated phone-gateway integration, e.g. TextBee).
 *
 * This migration is ADDITIVE and completely isolated from the existing
 * SMS/Telegram OTP pipeline. It never touches `settings.sms.provider.config`,
 * `sms_templates`, `notification_*` or `bulk_notification*` tables. Everything
 * introduced here is prefixed `bulk_sms_` so there is zero collision risk:
 *
 *   - bulk_sms_gateway_settings → one row per tenant: gateway credentials +
 *                                 sending limits. The API key is stored sealed
 *                                 (AES-256-GCM) and never echoed back plain.
 *   - bulk_sms_templates        → reusable message templates ({name} variables).
 *   - bulk_sms_campaigns        → admin marketing campaigns.
 *   - bulk_sms_queue            → per-recipient send queue (worker + retries).
 *   - bulk_sms_logs             → permanent delivery history for reporting.
 *
 * All tables are tenant-scoped with the standard RLS pattern
 * (app_is_bypass_rls() OR tenant_id = get_tenant_context()).
 */

exports.shorthands = undefined;

const tenantPolicy = (pgm, table) => {
  pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY ${table}_tenant_isolation ON ${table}
    FOR ALL
    USING (
      app_is_bypass_rls()
      OR tenant_id = get_tenant_context()
    )
    WITH CHECK (
      app_is_bypass_rls()
      OR tenant_id = get_tenant_context()
    );
  `);
};

exports.up = (pgm) => {
  /* ---------------------------------------------------------------------- */
  /* bulk_sms_gateway_settings                                              */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('bulk_sms_gateway_settings', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    enabled: { type: 'boolean', notNull: true, default: false },
    gateway_name: { type: 'text', notNull: true, default: 'TextBee' },
    api_url: { type: 'text', notNull: true, default: 'https://api.textbee.dev/api/v1' },
    /** AES-256-GCM sealed API key — plaintext is NEVER stored or echoed. */
    api_key_sealed: { type: 'text' },
    device_id: { type: 'text' },
    sender_number: { type: 'text' },
    default_country_code: { type: 'text', notNull: true, default: '+251' },
    max_sms_per_day: { type: 'integer', notNull: true, default: 1000 },
    /** Delay between two consecutive sends, in milliseconds (rate limiting). */
    delay_ms: { type: 'integer', notNull: true, default: 1000 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
  });
  // One settings row per tenant.
  pgm.addConstraint('bulk_sms_gateway_settings', 'bulk_sms_gateway_settings_tenant_uniq', {
    unique: ['tenant_id'],
  });
  pgm.sql(`
    CREATE TRIGGER bulk_sms_gateway_settings_touch_updated_at
    BEFORE UPDATE ON bulk_sms_gateway_settings
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  `);
  tenantPolicy(pgm, 'bulk_sms_gateway_settings');

  /* ---------------------------------------------------------------------- */
  /* bulk_sms_templates                                                     */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('bulk_sms_templates', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    name: { type: 'text', notNull: true },
    body: { type: 'text', notNull: true },
    created_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('bulk_sms_templates', 'tenant_id');
  pgm.createIndex('bulk_sms_templates', ['tenant_id', 'created_at']);
  pgm.sql(`
    CREATE TRIGGER bulk_sms_templates_touch_updated_at
    BEFORE UPDATE ON bulk_sms_templates
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  `);
  tenantPolicy(pgm, 'bulk_sms_templates');

  /* ---------------------------------------------------------------------- */
  /* bulk_sms_campaigns                                                     */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('bulk_sms_campaigns', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    name: { type: 'text', notNull: true },
    template_id: {
      type: 'uuid',
      references: 'bulk_sms_templates(id)',
      onDelete: 'SET NULL',
    },
    /** Rendered message body used when a template variable is not per-row. */
    message: { type: 'text', notNull: true },
    /** 'draft' | 'queued' | 'sending' | 'completed' | 'failed' | 'cancelled'. */
    status: { type: 'text', notNull: true, default: 'queued' },
    total_recipients: { type: 'integer', notNull: true, default: 0 },
    sent_count: { type: 'integer', notNull: true, default: 0 },
    failed_count: { type: 'integer', notNull: true, default: 0 },
    created_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    started_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
  });
  pgm.createIndex('bulk_sms_campaigns', 'tenant_id');
  pgm.createIndex('bulk_sms_campaigns', ['tenant_id', 'status']);
  pgm.createIndex('bulk_sms_campaigns', ['tenant_id', 'created_at']);
  pgm.sql(`
    CREATE TRIGGER bulk_sms_campaigns_touch_updated_at
    BEFORE UPDATE ON bulk_sms_campaigns
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  `);
  tenantPolicy(pgm, 'bulk_sms_campaigns');

  /* ---------------------------------------------------------------------- */
  /* bulk_sms_queue                                                         */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('bulk_sms_queue', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    campaign_id: {
      type: 'uuid',
      notNull: true,
      references: 'bulk_sms_campaigns(id)',
      onDelete: 'CASCADE',
    },
    /** Normalized E.164-ish phone (country code applied at import time). */
    phone: { type: 'text', notNull: true },
    message: { type: 'text', notNull: true },
    /** 'pending' | 'processing' | 'sent' | 'failed'. */
    status: { type: 'text', notNull: true, default: 'pending' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    error: { type: 'text' },
    /** Raw provider (TextBee) response payload for debugging / audit. */
    provider_response: { type: 'jsonb' },
    /** Earliest time the row may be (re)attempted — backoff on retries. */
    next_attempt_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    sent_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('bulk_sms_queue', 'tenant_id');
  pgm.createIndex('bulk_sms_queue', 'campaign_id');
  // Worker claim query filters (tenant, status, next_attempt_at).
  pgm.createIndex('bulk_sms_queue', ['tenant_id', 'status', 'next_attempt_at']);
  pgm.sql(`
    CREATE TRIGGER bulk_sms_queue_touch_updated_at
    BEFORE UPDATE ON bulk_sms_queue
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  `);
  tenantPolicy(pgm, 'bulk_sms_queue');

  /* ---------------------------------------------------------------------- */
  /* bulk_sms_logs (permanent delivery history)                             */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('bulk_sms_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    campaign_id: {
      type: 'uuid',
      references: 'bulk_sms_campaigns(id)',
      onDelete: 'SET NULL',
    },
    phone: { type: 'text', notNull: true },
    message: { type: 'text', notNull: true },
    /** 'sent' | 'failed'. */
    status: { type: 'text', notNull: true },
    provider_response: { type: 'jsonb' },
    error: { type: 'text' },
    sent_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('bulk_sms_logs', 'tenant_id');
  pgm.createIndex('bulk_sms_logs', 'campaign_id');
  pgm.createIndex('bulk_sms_logs', ['tenant_id', 'created_at']);
  pgm.createIndex('bulk_sms_logs', ['tenant_id', 'status']);
  // Daily-limit accounting counts sent rows per tenant per day.
  pgm.createIndex('bulk_sms_logs', ['tenant_id', 'sent_at']);
  tenantPolicy(pgm, 'bulk_sms_logs');
};

exports.down = (pgm) => {
  pgm.sql(`DROP POLICY IF EXISTS bulk_sms_logs_tenant_isolation ON bulk_sms_logs`);
  pgm.dropTable('bulk_sms_logs');

  pgm.sql(`DROP TRIGGER IF EXISTS bulk_sms_queue_touch_updated_at ON bulk_sms_queue`);
  pgm.sql(`DROP POLICY IF EXISTS bulk_sms_queue_tenant_isolation ON bulk_sms_queue`);
  pgm.dropTable('bulk_sms_queue');

  pgm.sql(`DROP TRIGGER IF EXISTS bulk_sms_campaigns_touch_updated_at ON bulk_sms_campaigns`);
  pgm.sql(`DROP POLICY IF EXISTS bulk_sms_campaigns_tenant_isolation ON bulk_sms_campaigns`);
  pgm.dropTable('bulk_sms_campaigns');

  pgm.sql(`DROP TRIGGER IF EXISTS bulk_sms_templates_touch_updated_at ON bulk_sms_templates`);
  pgm.sql(`DROP POLICY IF EXISTS bulk_sms_templates_tenant_isolation ON bulk_sms_templates`);
  pgm.dropTable('bulk_sms_templates');

  pgm.sql(`DROP TRIGGER IF EXISTS bulk_sms_gateway_settings_touch_updated_at ON bulk_sms_gateway_settings`);
  pgm.sql(`DROP POLICY IF EXISTS bulk_sms_gateway_settings_tenant_isolation ON bulk_sms_gateway_settings`);
  pgm.dropTable('bulk_sms_gateway_settings');
};
