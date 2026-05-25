/**
 * telebirr_transactions
 *  - One row per parsed Telebirr payment SMS. The natural key is
 *    `telebirr_ref` (issued by Ethio Telecom in the SMS body) and is
 *    declared GLOBALLY UNIQUE so the same payment cannot be credited
 *    twice — even if the SMS is delivered to multiple devices, replayed,
 *    or mistakenly forwarded across tenants. This is the system's most
 *    important double-credit guard.
 *  - Lifecycle:
 *      pending   -> SMS parsed, not yet matched to a deposit request /
 *                   user
 *      matched   -> linked to a user_id + wallet_id; ready to credit
 *      credited  -> linked to a transactions(id) wallet ledger row
 *      duplicate -> the same telebirr_ref was seen again (the original
 *                   row stays as the canonical record)
 *      unmatched -> parsed but no deposit request / user could be
 *                   linked; exposed in the admin "Deposit Queue" for
 *                   manual matching
 *      disputed  -> manually flagged for investigation
 *  - sms_body keeps the raw message even though telebirr_sms_raw also
 *    has it; this lets the admin UI render a single-row context without
 *    a join.
 *  - credit_transaction_id is RESTRICTed on delete so we never lose the
 *    forensic link to the wallet ledger row that actually credited the
 *    user.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('telebirr_transactions', {
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
      onDelete: 'RESTRICT',
    },
    user_id: {
      type: 'uuid',
      references: 'users(id)',
      onDelete: 'SET NULL',
    },
    wallet_id: {
      type: 'uuid',
      references: 'wallets(id)',
      onDelete: 'SET NULL',
    },
    telebirr_ref: { type: 'text', notNull: true },
    sender_phone: { type: 'text' },
    sender_name: { type: 'text' },
    amount: { type: 'numeric(18,2)', notNull: true },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    sms_body: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'pending' },
    matched_at: { type: 'timestamptz' },
    credited_at: { type: 'timestamptz' },
    credit_transaction_id: {
      type: 'uuid',
      references: 'transactions(id)',
      onDelete: 'RESTRICT',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('telebirr_transactions', 'telebirr_transactions_status_check', {
    check:
      "status IN ('pending','matched','credited','duplicate','unmatched','disputed')",
  });
  pgm.addConstraint('telebirr_transactions', 'telebirr_transactions_amount_positive', {
    check: 'amount > 0',
  });
  // Globally unique — see file header.
  pgm.addConstraint('telebirr_transactions', 'telebirr_transactions_ref_unique', {
    unique: ['telebirr_ref'],
  });

  pgm.createIndex('telebirr_transactions', 'tenant_id');
  pgm.createIndex('telebirr_transactions', 'agent_id');
  pgm.createIndex('telebirr_transactions', 'user_id');
  pgm.createIndex('telebirr_transactions', 'wallet_id');
  pgm.createIndex('telebirr_transactions', 'sender_phone');
  pgm.createIndex('telebirr_transactions', 'status');
  pgm.createIndex('telebirr_transactions', 'created_at');
  pgm.createIndex('telebirr_transactions', 'credit_transaction_id');
  pgm.createIndex('telebirr_transactions', ['tenant_id', 'status']);
  pgm.createIndex('telebirr_transactions', ['tenant_id', 'created_at']);
  pgm.createIndex('telebirr_transactions', ['tenant_id', 'agent_id', 'created_at']);

  pgm.sql(`ALTER TABLE telebirr_transactions ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE telebirr_transactions FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY telebirr_transactions_tenant_isolation ON telebirr_transactions
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
  pgm.sql(
    `DROP POLICY IF EXISTS telebirr_transactions_tenant_isolation ON telebirr_transactions`
  );
  pgm.dropTable('telebirr_transactions');
};
