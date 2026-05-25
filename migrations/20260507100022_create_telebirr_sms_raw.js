/**
 * telebirr_sms_raw
 *  - Append-only log of every SMS the agent device has uploaded to the
 *    backend. We persist the raw body BEFORE parsing so we can replay
 *    the parser, audit fraud disputes, and detect duplicate deliveries.
 *  - `processed = true` is set after the SMS has been parsed into a
 *    telebirr_transactions row (or determined to be non-financial /
 *    unparseable). Never delete rows from this table.
 *  - sender_number is the Telebirr/operator short-code that delivered
 *    the message; received_at is the timestamp parsed from the SMS body
 *    when present, otherwise the time the device received it.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('telebirr_sms_raw', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    agent_id: {
      type: 'uuid',
      notNull: true,
      references: 'telebirr_agents(id)',
      onDelete: 'CASCADE',
    },
    sms_body: { type: 'text', notNull: true },
    sender_number: { type: 'text' },
    received_at: { type: 'timestamptz' },
    processed: { type: 'boolean', notNull: true, default: false },
    processed_at: { type: 'timestamptz' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Per spec: index agent_id, processed, received_at; plus tenant_id for
  // tenant-scoped admin queries and a hot-path composite for the SMS
  // worker (give me unprocessed rows for this agent ordered by received).
  pgm.createIndex('telebirr_sms_raw', 'tenant_id');
  pgm.createIndex('telebirr_sms_raw', 'agent_id');
  pgm.createIndex('telebirr_sms_raw', 'processed');
  pgm.createIndex('telebirr_sms_raw', 'received_at');
  pgm.createIndex('telebirr_sms_raw', 'created_at');
  pgm.createIndex('telebirr_sms_raw', ['agent_id', 'processed', 'received_at']);
  pgm.createIndex('telebirr_sms_raw', ['tenant_id', 'created_at']);

  pgm.sql(`ALTER TABLE telebirr_sms_raw ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE telebirr_sms_raw FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY telebirr_sms_raw_tenant_isolation ON telebirr_sms_raw
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

exports.down = (pgm) => {
  pgm.sql(`DROP POLICY IF EXISTS telebirr_sms_raw_tenant_isolation ON telebirr_sms_raw`);
  pgm.dropTable('telebirr_sms_raw');
};
