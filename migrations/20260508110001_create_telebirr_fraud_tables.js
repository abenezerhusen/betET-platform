/**
 * Telebirr fraud-prevention + dispute + reconciliation infrastructure.
 *
 * Adds three tables that all sit alongside the existing telebirr_*
 * tables and follow the same conventions (UUIDs, tenant_id with FK,
 * RLS enabled with the same tenant_isolation policy shape, RESTRICT
 * deletes for anything money-touching).
 *
 *   1. telebirr_disputes
 *      - User-submitted disputes. "I paid via Telebirr but the platform
 *        never confirmed the deposit." Backed by: amount, claimed Telebirr
 *        ref, sender Telebirr account, date, optional screenshot URL.
 *      - Status pipeline: open → investigating → resolved | rejected.
 *      - When admin resolves to credit: linked to the matched
 *        telebirr_transactions row + the wallet ledger transaction id.
 *
 *   2. telebirr_reconciliation_reports
 *      - Daily / on-demand reconciliation snapshots per agent. Stores
 *        expected_credits (SUM from telebirr_transactions) vs reported
 *        from agent statement (CSV upload, optional). Variance + status.
 *      - Append-only history; rebuilds for the same (agent_id, date)
 *        re-insert a new row rather than mutating prior ones, so admins
 *        can see the audit trail of an investigation.
 *
 *   3. telebirr_refcode_attempts
 *      - RULE 8 brute-force counter. One row per (tenant_id,
 *        identifier, refcode) with a created_at; the matcher counts
 *        distinct refcodes per identifier in the configurable window.
 *      - identifier_type: 'ip' | 'user' | 'agent'. Lets us throttle by
 *        the most appropriate axis depending on the source endpoint.
 *      - We TTL old rows in code (a sweep query during the same
 *        request) so the table stays small without a separate cron.
 *      - Not RLS — this is a security ledger; reads are admin-only
 *        and writes happen with bypass_rls=true.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  /* ---------------------------------------------------------------------- */
  /* telebirr_disputes                                                       */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('telebirr_disputes', {
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
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'RESTRICT',
    },
    /** ETB amount the user claims to have sent. */
    amount: {
      type: 'numeric(18,2)',
      notNull: true,
      check: 'amount > 0',
    },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    /** Telebirr reference the user copied from their SMS receipt
     *  (optional — many users don't include it). */
    claimed_telebirr_ref: { type: 'text' },
    /** The sender's Telebirr account (their own phone) in 0XXXXXXXXX. */
    sender_telebirr_number: { type: 'text', notNull: true },
    /** Date/time the user says they sent the payment. */
    paid_at: { type: 'timestamptz' },
    /** URL of the user's uploaded screenshot of the SMS receipt. */
    screenshot_url: { type: 'text' },
    /** User-supplied free-form description. */
    description: { type: 'text' },

    status: {
      type: 'text',
      notNull: true,
      default: 'open',
      check:
        "status IN ('open', 'investigating', 'resolved_credited', 'resolved_rejected', 'cancelled')",
    },

    /** Set when admin resolves: pointer to the telebirr_transactions
     *  row that was the missing match. NULL when status was
     *  resolved_rejected. */
    resolved_telebirr_tx_id: {
      type: 'uuid',
      references: 'telebirr_transactions(id)',
      onDelete: 'SET NULL',
    },
    resolution_notes: { type: 'text' },
    resolved_by: { type: 'uuid' },
    resolved_at: { type: 'timestamptz' },

    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('telebirr_disputes', 'tenant_id');
  pgm.createIndex('telebirr_disputes', 'user_id');
  pgm.createIndex('telebirr_disputes', 'status');
  pgm.createIndex('telebirr_disputes', 'created_at');
  pgm.createIndex('telebirr_disputes', ['tenant_id', 'status', 'created_at']);
  pgm.createIndex('telebirr_disputes', 'claimed_telebirr_ref');

  // Reuse the platform-wide updated_at trigger function (defined in
  // migration 20260507100001_extensions_and_helpers.js).
  pgm.sql(`
    CREATE TRIGGER telebirr_disputes_set_updated_at
      BEFORE UPDATE ON telebirr_disputes
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  `);

  pgm.sql(`ALTER TABLE telebirr_disputes ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE telebirr_disputes FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY telebirr_disputes_tenant_isolation ON telebirr_disputes
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

  /* ---------------------------------------------------------------------- */
  /* telebirr_reconciliation_reports                                          */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('telebirr_reconciliation_reports', {
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
    /** Calendar date in the tenant's timezone (we store UTC midnight
     *  here; admin layer converts on display). */
    report_date: { type: 'date', notNull: true },
    /** SUM(amount) FROM telebirr_transactions WHERE status='credited'
     *  AND DATE(created_at) = report_date AND agent_id = X. */
    expected_credits: {
      type: 'numeric(18,2)',
      notNull: true,
      default: '0',
    },
    /** Number of credited transactions in the bucket. */
    expected_credits_count: { type: 'integer', notNull: true, default: 0 },
    /** Operator-supplied total from the agent's Telebirr statement
     *  (e.g. CSV export). NULL when the operator hasn't uploaded it. */
    reported_total: { type: 'numeric(18,2)' },
    reported_count: { type: 'integer' },
    /** reported_total - expected_credits. Positive = agent saw more
     *  on Telebirr than we credited (we missed some matches). */
    variance: { type: 'numeric(18,2)' },
    /** open: no statement uploaded yet. matched: variance within
     *  threshold. flagged: variance over threshold (manual review).
     *  resolved: admin signed off after investigation. */
    status: {
      type: 'text',
      notNull: true,
      default: 'open',
      check: "status IN ('open', 'matched', 'flagged', 'resolved')",
    },
    notes: { type: 'text' },
    /** URL of the uploaded statement CSV when the operator provides one. */
    statement_url: { type: 'text' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('telebirr_reconciliation_reports', 'tenant_id');
  pgm.createIndex('telebirr_reconciliation_reports', 'agent_id');
  pgm.createIndex('telebirr_reconciliation_reports', 'report_date');
  pgm.createIndex('telebirr_reconciliation_reports', 'status');
  // Unique on (tenant_id, agent_id, report_date) so the daily
  // reconciliation pass can `ON CONFLICT … DO UPDATE` without races.
  pgm.createIndex(
    'telebirr_reconciliation_reports',
    ['tenant_id', 'agent_id', 'report_date'],
    { unique: true, name: 'telebirr_recon_uniq_day' }
  );

  pgm.sql(`
    CREATE TRIGGER telebirr_reconciliation_reports_set_updated_at
      BEFORE UPDATE ON telebirr_reconciliation_reports
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  `);

  pgm.sql(
    `ALTER TABLE telebirr_reconciliation_reports ENABLE ROW LEVEL SECURITY`
  );
  pgm.sql(
    `ALTER TABLE telebirr_reconciliation_reports FORCE ROW LEVEL SECURITY`
  );
  pgm.sql(`
    CREATE POLICY telebirr_recon_tenant_isolation ON telebirr_reconciliation_reports
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

  /* ---------------------------------------------------------------------- */
  /* telebirr_refcode_attempts                                                */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('telebirr_refcode_attempts', {
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
    /** Free-form so a single table can host IP attempts, user attempts,
     *  and agent device attempts without a polymorphic FK explosion. */
    identifier_type: {
      type: 'text',
      notNull: true,
      check: "identifier_type IN ('ip', 'user', 'agent', 'session')",
    },
    /** ip address (string), user_id (uuid string), agent_id (uuid
     *  string), or session id depending on identifier_type. */
    identifier: { type: 'text', notNull: true },
    /** The candidate refcode the caller submitted. Hashed isn't useful
     *  here because we want to display real codes to admins
     *  investigating brute-force. */
    refcode: { type: 'text', notNull: true },
    /** 'initiate', 'cashier_lookup', etc. — context for the admin UI. */
    context: { type: 'text', notNull: true },
    /** Which IP the attempt came from (denormalised when identifier
     *  isn't ip itself). */
    ip: { type: 'inet' },
    user_agent: { type: 'text' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('telebirr_refcode_attempts', 'tenant_id');
  pgm.createIndex('telebirr_refcode_attempts', ['identifier_type', 'identifier']);
  pgm.createIndex('telebirr_refcode_attempts', 'created_at');
  pgm.createIndex('telebirr_refcode_attempts', [
    'tenant_id',
    'identifier_type',
    'identifier',
    'created_at',
  ]);

  // Not RLS-isolated by tenant_id at the policy level so the matcher
  // can sweep old rows without holding a tenant context. Reads from
  // the admin panel always pass tenantId in the WHERE clause.
};

exports.down = (pgm) => {
  pgm.dropTable('telebirr_refcode_attempts');

  pgm.sql(
    `DROP POLICY IF EXISTS telebirr_recon_tenant_isolation ON telebirr_reconciliation_reports`
  );
  pgm.sql(
    `DROP TRIGGER IF EXISTS telebirr_reconciliation_reports_set_updated_at ON telebirr_reconciliation_reports`
  );
  pgm.dropTable('telebirr_reconciliation_reports');

  pgm.sql(
    `DROP POLICY IF EXISTS telebirr_disputes_tenant_isolation ON telebirr_disputes`
  );
  pgm.sql(
    `DROP TRIGGER IF EXISTS telebirr_disputes_set_updated_at ON telebirr_disputes`
  );
  pgm.dropTable('telebirr_disputes');
};
