/**
 * cashier_transactions
 *  - Operations performed by cashier users (branch counter): deposits to
 *    customer wallets, withdrawals from customer wallets, ticket sell /
 *    payout / cancel, jackpot sell / payout.
 *  - Distinct from `transactions` which is the wallet ledger; these rows
 *    represent the cashier-originated business event and link by reference.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('cashier_transactions', {
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
    cashier_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
    },
    user_id: {
      type: 'uuid',
      references: 'users(id)',
    },
    branch_id: { type: 'uuid' },
    type: { type: 'text', notNull: true },
    amount: { type: 'numeric(20,4)', notNull: true },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    status: { type: 'text', notNull: true, default: 'pending' },
    reference: { type: 'text' },
    notes: { type: 'text' },
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
    completed_at: { type: 'timestamptz' },
  });

  pgm.addConstraint('cashier_transactions', 'cashier_transactions_type_check', {
    check:
      "type IN ('deposit','withdrawal','ticket_sell','ticket_payout','ticket_cancel','jackpot_payout','jackpot_sell','adjustment')",
  });
  pgm.addConstraint('cashier_transactions', 'cashier_transactions_status_check', {
    check:
      "status IN ('pending','approved','rejected','completed','cancelled','failed')",
  });
  pgm.addConstraint('cashier_transactions', 'cashier_transactions_amount_nonneg', {
    check: 'amount >= 0',
  });

  pgm.sql(
    `CREATE UNIQUE INDEX cashier_tx_tenant_reference_key ON cashier_transactions (tenant_id, reference) WHERE reference IS NOT NULL`
  );

  pgm.createIndex('cashier_transactions', 'tenant_id');
  pgm.createIndex('cashier_transactions', 'cashier_id');
  pgm.createIndex('cashier_transactions', 'user_id');
  pgm.createIndex('cashier_transactions', 'type');
  pgm.createIndex('cashier_transactions', 'status');
  pgm.createIndex('cashier_transactions', 'created_at');
  pgm.createIndex('cashier_transactions', ['tenant_id', 'cashier_id']);
  pgm.createIndex('cashier_transactions', ['tenant_id', 'created_at']);
  pgm.createIndex('cashier_transactions', ['tenant_id', 'type', 'status']);

  pgm.sql(`ALTER TABLE cashier_transactions ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE cashier_transactions FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY cashier_transactions_tenant_isolation ON cashier_transactions
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
    `DROP POLICY IF EXISTS cashier_transactions_tenant_isolation ON cashier_transactions`
  );
  pgm.dropTable('cashier_transactions');
};
