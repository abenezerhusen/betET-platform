/**
 * Notification system tables (multi-provider: SMS + Telegram Gateway).
 *
 * This migration is additive and does NOT touch the existing SMS pipeline
 * (settings key `sms.provider.config`, `sms_templates`). It introduces:
 *
 *   - notification_logs            → delivery log for every outbound
 *                                    notification routed through the
 *                                    central notification service.
 *   - notification_otps            → OTP codes for registration / login /
 *                                    password-reset, delivered through the
 *                                    active provider (SMS or Telegram).
 *   - bulk_notifications           → admin broadcast campaigns.
 *   - bulk_notification_recipients → per-user queue rows processed by the
 *                                    notification worker (large-scale ready).
 *
 * All tables are tenant-scoped with the same RLS pattern used across the
 * platform (app_is_bypass_rls() OR tenant_id = get_tenant_context()).
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
  /* notification_logs                                                      */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('notification_logs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    /** Nullable — system/marketing sends may not target a known user row. */
    user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    /** 'sms' | 'telegram'. */
    channel: { type: 'text', notNull: true },
    /** Provider slug actually used (e.g. 'sms', 'telegram_gateway'). */
    provider: { type: 'text' },
    /** Category, e.g. 'auth', 'wallet', 'security', 'system', 'marketing'. */
    category: { type: 'text', notNull: true, default: 'system' },
    /** Fine-grained event key, e.g. 'registration_otp', 'deposit_successful'. */
    event_type: { type: 'text', notNull: true },
    /** Destination address (phone / chat id) — trimmed, never a secret. */
    recipient: { type: 'text' },
    message: { type: 'text' },
    /** 'queued' | 'sent' | 'failed' | 'skipped'. */
    status: { type: 'text', notNull: true, default: 'queued' },
    error: { type: 'text' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    sent_at: { type: 'timestamptz' },
  });
  pgm.createIndex('notification_logs', 'tenant_id');
  pgm.createIndex('notification_logs', ['tenant_id', 'created_at']);
  pgm.createIndex('notification_logs', ['tenant_id', 'event_type']);
  pgm.createIndex('notification_logs', ['tenant_id', 'status']);
  pgm.createIndex('notification_logs', 'user_id');
  tenantPolicy(pgm, 'notification_logs');

  /* ---------------------------------------------------------------------- */
  /* notification_otps                                                      */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('notification_otps', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    /** 'register' | 'login' | 'password_reset'. */
    purpose: { type: 'text', notNull: true },
    /** Normalized destination the OTP was sent to (phone or email). */
    identifier: { type: 'text', notNull: true },
    /** 'sms' | 'telegram'. */
    channel: { type: 'text', notNull: true },
    /** SHA-256 hash of the numeric code — plaintext is never stored. */
    code_hash: { type: 'text', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    consumed_at: { type: 'timestamptz' },
    /** Verification attempts, used to lock brute-force guessing. */
    attempts: { type: 'integer', notNull: true, default: 0 },
    ip: { type: 'inet' },
    user_agent: { type: 'text' },
    metadata: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('notification_otps', 'tenant_id');
  pgm.createIndex('notification_otps', ['tenant_id', 'purpose', 'identifier']);
  pgm.createIndex('notification_otps', 'expires_at');
  tenantPolicy(pgm, 'notification_otps');

  /* ---------------------------------------------------------------------- */
  /* bulk_notifications                                                     */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('bulk_notifications', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    title: { type: 'text', notNull: true, default: '' },
    message: { type: 'text', notNull: true },
    /** 'all' | 'active' | 'vip' | 'selected'. */
    audience: { type: 'text', notNull: true, default: 'all' },
    /** For 'selected' → { user_ids: [] }; future filters live here too. */
    audience_filter: { type: 'jsonb', notNull: true, default: pgm.func("'{}'::jsonb") },
    /** 'sms' | 'telegram' | 'default' (use tenant default provider). */
    channel: { type: 'text', notNull: true, default: 'default' },
    /** 'system' | 'marketing'. Drives category on emitted notifications. */
    category: { type: 'text', notNull: true, default: 'marketing' },
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
  pgm.createIndex('bulk_notifications', 'tenant_id');
  pgm.createIndex('bulk_notifications', ['tenant_id', 'status']);
  pgm.createIndex('bulk_notifications', ['tenant_id', 'created_at']);
  pgm.sql(`
    CREATE TRIGGER bulk_notifications_touch_updated_at
    BEFORE UPDATE ON bulk_notifications
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  `);
  tenantPolicy(pgm, 'bulk_notifications');

  /* ---------------------------------------------------------------------- */
  /* bulk_notification_recipients (queue)                                   */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('bulk_notification_recipients', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    bulk_id: {
      type: 'uuid',
      notNull: true,
      references: 'bulk_notifications(id)',
      onDelete: 'CASCADE',
    },
    user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    recipient: { type: 'text' },
    /** 'pending' | 'sent' | 'failed' | 'skipped'. */
    status: { type: 'text', notNull: true, default: 'pending' },
    attempts: { type: 'integer', notNull: true, default: 0 },
    error: { type: 'text' },
    sent_at: { type: 'timestamptz' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('bulk_notification_recipients', 'tenant_id');
  pgm.createIndex('bulk_notification_recipients', 'bulk_id');
  // Worker claim query filters by (status, tenant) — index accelerates it.
  pgm.createIndex('bulk_notification_recipients', ['status', 'tenant_id']);
  tenantPolicy(pgm, 'bulk_notification_recipients');
};

exports.down = (pgm) => {
  pgm.sql(`DROP POLICY IF EXISTS bulk_notification_recipients_tenant_isolation ON bulk_notification_recipients`);
  pgm.dropTable('bulk_notification_recipients');

  pgm.sql(`DROP TRIGGER IF EXISTS bulk_notifications_touch_updated_at ON bulk_notifications`);
  pgm.sql(`DROP POLICY IF EXISTS bulk_notifications_tenant_isolation ON bulk_notifications`);
  pgm.dropTable('bulk_notifications');

  pgm.sql(`DROP POLICY IF EXISTS notification_otps_tenant_isolation ON notification_otps`);
  pgm.dropTable('notification_otps');

  pgm.sql(`DROP POLICY IF EXISTS notification_logs_tenant_isolation ON notification_logs`);
  pgm.dropTable('notification_logs');
};
