/**
 * wallets
 *  - One wallet per (tenant, user, currency).
 *  - Tracks main, bonus, and locked balances separately.
 *  - version supports optimistic concurrency control.
 *  - All balance mutations should also append to transactions for ledger.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('wallets', {
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
      onDelete: 'CASCADE',
    },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    balance: { type: 'numeric(20,4)', notNull: true, default: 0 },
    bonus_balance: { type: 'numeric(20,4)', notNull: true, default: 0 },
    locked_balance: { type: 'numeric(20,4)', notNull: true, default: 0 },
    status: { type: 'text', notNull: true, default: 'active' },
    version: { type: 'integer', notNull: true, default: 0 },
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

  pgm.addConstraint('wallets', 'wallets_balance_nonneg', {
    check: 'balance >= 0',
  });
  pgm.addConstraint('wallets', 'wallets_bonus_nonneg', {
    check: 'bonus_balance >= 0',
  });
  pgm.addConstraint('wallets', 'wallets_locked_nonneg', {
    check: 'locked_balance >= 0',
  });
  pgm.addConstraint('wallets', 'wallets_status_check', {
    check: "status IN ('active','frozen','closed')",
  });
  pgm.addConstraint('wallets', 'wallets_user_currency_unique', {
    unique: ['tenant_id', 'user_id', 'currency'],
  });

  pgm.createIndex('wallets', 'tenant_id');
  pgm.createIndex('wallets', 'user_id');
  pgm.createIndex('wallets', 'status');
  pgm.createIndex('wallets', 'created_at');
  pgm.createIndex('wallets', ['tenant_id', 'user_id']);
  pgm.createIndex('wallets', ['tenant_id', 'status']);

  pgm.createTrigger('wallets', 'wallets_touch_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'touch_updated_at',
  });

  pgm.sql(`ALTER TABLE wallets ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE wallets FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY wallets_tenant_isolation ON wallets
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
  pgm.sql(`DROP POLICY IF EXISTS wallets_tenant_isolation ON wallets`);
  pgm.dropTrigger('wallets', 'wallets_touch_updated_at');
  pgm.dropTable('wallets');
};
