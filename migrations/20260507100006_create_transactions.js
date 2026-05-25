/**
 * transactions
 *  - Append-only ledger for every wallet movement.
 *  - before_balance / after_balance let us audit balance evolution without
 *    replaying. amount is signed at the application layer (positive credit,
 *    negative debit) but the type column drives semantics.
 *  - reference is a tenant-scoped idempotency / external correlation key.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('transactions', {
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
    wallet_id: {
      type: 'uuid',
      notNull: true,
      references: 'wallets(id)',
      onDelete: 'RESTRICT',
    },
    user_id: {
      type: 'uuid',
      references: 'users(id)',
    },
    type: { type: 'text', notNull: true },
    amount: { type: 'numeric(20,4)', notNull: true },
    before_balance: { type: 'numeric(20,4)', notNull: true },
    after_balance: { type: 'numeric(20,4)', notNull: true },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    reference: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'completed' },
    metadata: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('transactions', 'transactions_type_check', {
    check:
      "type IN ('deposit','withdrawal','bet_stake','bet_win','bet_refund','bonus_credit','bonus_debit','transfer_in','transfer_out','adjustment','commission','cashier_deposit','cashier_withdrawal','p2p_deposit','p2p_withdrawal','jackpot_win','rollback')",
  });
  pgm.addConstraint('transactions', 'transactions_status_check', {
    check: "status IN ('pending','completed','failed','reversed','cancelled')",
  });

  pgm.sql(
    `CREATE UNIQUE INDEX transactions_tenant_reference_key ON transactions (tenant_id, reference) WHERE reference IS NOT NULL`
  );

  pgm.createIndex('transactions', 'tenant_id');
  pgm.createIndex('transactions', 'wallet_id');
  pgm.createIndex('transactions', 'user_id');
  pgm.createIndex('transactions', 'type');
  pgm.createIndex('transactions', 'status');
  pgm.createIndex('transactions', 'created_at');
  pgm.createIndex('transactions', ['tenant_id', 'created_at']);
  pgm.createIndex('transactions', ['wallet_id', 'created_at']);
  pgm.createIndex('transactions', ['tenant_id', 'type', 'created_at']);

  pgm.sql(`ALTER TABLE transactions ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE transactions FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY transactions_tenant_isolation ON transactions
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
  pgm.sql(`DROP POLICY IF EXISTS transactions_tenant_isolation ON transactions`);
  pgm.dropTable('transactions');
};
