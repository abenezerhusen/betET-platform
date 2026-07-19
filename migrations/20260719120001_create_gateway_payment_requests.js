/**
 * Online Payment Gateway — deposit & withdrawal request ledger.
 *
 * Backs the admin-configurable "Online Payment" methods (Telebirr,
 * CBE Birr, M-Pesa) shown in the user panel's Deposit / Withdraw
 * "Online Payment" tab.
 *
 * This system is fully INDEPENDENT of the Telebirr P2P, admin P2P and
 * branch-withdrawal systems — it never reads or writes any of their
 * tables. It is built so a real payment-gateway API (hosted checkout /
 * redirect + webhook) can be wired in later WITHOUT a schema change:
 *   - `provider_ref` holds the upstream gateway reference,
 *   - `status`       follows pending -> processing -> completed/failed,
 *   - `metadata`     stores raw provider payloads for reconciliation.
 *
 * For withdrawals the wallet debit happens at request time (funds move
 * from balance -> locked_balance) via `debit_transaction_id`, so a user
 * cannot double-spend the reserved amount. Deposits credit nothing
 * until a gateway confirmation arrives (future webhook / admin action).
 *
 * The migration also seeds the three default gateway rows into
 * `payment_methods` for every existing tenant (idempotent). Admins
 * enable/disable and configure them from the Payment Configuration page.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('gateway_payment_requests', {
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
    /** 'deposit' | 'withdrawal'. */
    direction: {
      type: 'text',
      notNull: true,
      check: "direction IN ('deposit','withdrawal')",
    },
    /** Gateway provider slug (e.g. 'telebirr_gateway','cbe_birr','mpesa').
     *  Distinct from the Telebirr P2P slug 'telebirr_p2p'. */
    provider_slug: { type: 'text', notNull: true },
    /** Display name captured at request time. */
    method_name: { type: 'text', notNull: true },
    amount: { type: 'numeric(18,2)', notNull: true, check: 'amount > 0' },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    /** Payee/payer phone (synced from profile unless admin allows edit). */
    phone: { type: 'text', notNull: true },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check:
        "status IN ('pending','processing','completed','failed','cancelled','expired')",
    },
    /** Our own idempotency reference. */
    reference: { type: 'text' },
    /** Upstream gateway reference (null until a real API is wired). */
    provider_ref: { type: 'text' },
    /** For withdrawals: the pending ledger row that locked the funds. */
    debit_transaction_id: {
      type: 'uuid',
      references: 'transactions(id)',
      onDelete: 'SET NULL',
    },
    /** Captures the credit row when a reserved withdrawal is reversed. */
    reversal_transaction_id: {
      type: 'uuid',
      references: 'transactions(id)',
      onDelete: 'SET NULL',
    },
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
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.createIndex('gateway_payment_requests', 'tenant_id');
  pgm.createIndex('gateway_payment_requests', 'user_id');
  pgm.createIndex('gateway_payment_requests', 'status');
  pgm.createIndex('gateway_payment_requests', [
    'tenant_id',
    'direction',
    'status',
    'created_at',
  ]);
  pgm.createIndex('gateway_payment_requests', [
    'tenant_id',
    'user_id',
    'created_at',
  ]);
  // Our reference is unique per tenant when present (idempotency guard).
  pgm.sql(`
    CREATE UNIQUE INDEX gateway_payment_requests_tenant_reference_uniq
      ON gateway_payment_requests (tenant_id, reference)
      WHERE reference IS NOT NULL
  `);

  pgm.sql(`
    CREATE TRIGGER gateway_payment_requests_set_updated_at
      BEFORE UPDATE ON gateway_payment_requests
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  `);

  pgm.sql(`ALTER TABLE gateway_payment_requests ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE gateway_payment_requests FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY gateway_payment_requests_tenant_isolation ON gateway_payment_requests
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
  /* Seed default gateway methods for every existing tenant (idempotent).   */
  /* These are separate rows from the Telebirr P2P method.                  */
  /* ---------------------------------------------------------------------- */
  const seed = (slug, name, order) =>
    pgm.sql(`
      INSERT INTO payment_methods
        (tenant_id, provider_slug, type, name, logo_url,
         min_amount, max_amount, currencies, countries,
         supports_deposit, supports_withdrawal, is_active,
         display_order, config)
      SELECT id, '${slug}', 'mobile_money', '${name}', NULL,
             10, 50000, '{ETB}', '{ET}',
             true, true, true, ${order}, '{}'::jsonb
        FROM tenants
      ON CONFLICT (tenant_id, provider_slug) DO NOTHING
    `);
  seed('telebirr_gateway', 'Telebirr', 10);
  seed('cbe_birr', 'CBE Birr', 11);
  seed('mpesa', 'M-Pesa', 12);
};

exports.down = (pgm) => {
  pgm.sql(`
    DELETE FROM payment_methods
     WHERE provider_slug IN ('telebirr_gateway','cbe_birr','mpesa')
  `);
  pgm.sql(
    `DROP POLICY IF EXISTS gateway_payment_requests_tenant_isolation ON gateway_payment_requests`
  );
  pgm.sql(
    `DROP TRIGGER IF EXISTS gateway_payment_requests_set_updated_at ON gateway_payment_requests`
  );
  pgm.dropTable('gateway_payment_requests');
};
