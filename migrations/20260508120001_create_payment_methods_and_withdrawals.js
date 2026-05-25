/**
 * Payment-gateway aggregator schema + Telebirr withdrawal flow.
 *
 *   1. payment_methods
 *      Per-tenant catalogue of payment options shown to users on the
 *      deposit/withdrawal pages. Each row references a provider slug
 *      (e.g. 'telebirr_p2p', 'chapa', 'mpesa') registered in the
 *      backend `providerRegistry`. Limits, fees, currencies, ordering
 *      and active status are configured per tenant so different
 *      operators can offer different mixes.
 *
 *      Lookup is cheap: GET /api/user/payment-methods filters
 *      `is_active=true AND ($currency IS NULL OR $currency = ANY(currencies))`
 *      and returns rows ordered by `display_order ASC`.
 *
 *   2. telebirr_withdrawal_requests
 *      Manual P2P withdrawal queue. The user requests a payout to
 *      their own Telebirr number; a cashier opens the Telebirr app,
 *      sends the money, and marks the request `completed` (recording
 *      the Telebirr reference of the outgoing transfer). The wallet
 *      debit happens at REQUEST TIME (so the user can't submit
 *      another withdrawal larger than their available balance) — the
 *      cashier action only flips status; failure paths reverse the
 *      debit via a 'p2p_withdrawal_reversal' adjustment.
 *
 *   3. telebirr_agents.last_assigned_at
 *      New nullable column used by the round-robin agent picker
 *      (see telebirr.repository.pickAvailableAgent). When two or
 *      more agents are tied on pending-load the picker prefers the
 *      one assigned least recently. Updated whenever the picker
 *      hands a deposit-request to an agent.
 *
 *   4. telebirr_withdrawal_requests.tenant_user_unique_open
 *      Partial unique index ensures a user can have at most ONE open
 *      (status='pending' or 'processing') withdrawal request at any
 *      moment — same one-deposit-at-a-time discipline we apply to
 *      telebirr_deposit_requests.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  /* ---------------------------------------------------------------------- */
  /* payment_methods                                                         */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('payment_methods', {
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
    /** slug from providerRegistry, e.g. 'telebirr_p2p'. NOT a FK because
     *  providers live in code, not in the DB. */
    provider_slug: { type: 'text', notNull: true },
    /** Display category shown to the user. Drives icon + grouping. */
    type: {
      type: 'text',
      notNull: true,
      check:
        "type IN ('mobile_money','bank_transfer','card','crypto','wallet','cash','voucher')",
    },
    /** Display name (e.g. "Telebirr P2P"). May vary per tenant. */
    name: { type: 'text', notNull: true },
    /** Public asset URL (served from the frontend's /assets/). */
    logo_url: { type: 'text' },
    /** Per-tenant deposit limits. NULL = use provider defaults. */
    min_amount: { type: 'numeric(18,2)' },
    max_amount: { type: 'numeric(18,2)' },
    /** Fees stored as numbers, never percentages-of-strings. fee_percent
     *  is the percentage of the transaction (10 = 10%); fee_fixed is a
     *  flat add-on. Both default to zero. */
    fee_percent: { type: 'numeric(7,4)', notNull: true, default: 0 },
    fee_fixed: { type: 'numeric(18,2)', notNull: true, default: 0 },
    /** ETA for the operator to mark the deposit complete. Telebirr P2P
     *  is 0 (instant credit); manual cashier-processed withdrawals
     *  may be 1–24h depending on staffing. */
    processing_time_hours: { type: 'integer', notNull: true, default: 0 },
    /** ISO-4217 codes the method supports for THIS tenant. Stored as
     *  text[] so admins can enable a subset of the provider's
     *  capability set. */
    currencies: { type: 'text[]', notNull: true, default: '{ETB}' },
    /** ISO-3166 alpha-2 codes. Used to gate visibility for users in
     *  particular countries (KYC future-proofing). */
    countries: { type: 'text[]', notNull: true, default: '{ET}' },
    /** Which channels this method is enabled for. */
    supports_deposit: { type: 'boolean', notNull: true, default: true },
    supports_withdrawal: { type: 'boolean', notNull: true, default: false },
    is_active: { type: 'boolean', notNull: true, default: true },
    /** Lower number => earlier in the list. */
    display_order: { type: 'integer', notNull: true, default: 100 },
    /** Free-form per-method config (e.g. webhook URL, merchant id, etc.).
     *  Provider-specific shape; never trusted as code-level config. */
    config: {
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

  pgm.createIndex('payment_methods', 'tenant_id');
  pgm.createIndex('payment_methods', 'provider_slug');
  pgm.createIndex('payment_methods', ['tenant_id', 'is_active', 'display_order']);
  // Each tenant may register a given provider at most once.
  pgm.addConstraint('payment_methods', 'payment_methods_tenant_provider_unique', {
    unique: ['tenant_id', 'provider_slug'],
  });

  pgm.sql(`
    CREATE TRIGGER payment_methods_set_updated_at
      BEFORE UPDATE ON payment_methods
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  `);

  pgm.sql(`ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE payment_methods FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY payment_methods_tenant_isolation ON payment_methods
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
  /* telebirr_withdrawal_requests                                            */
  /* ---------------------------------------------------------------------- */
  pgm.createTable('telebirr_withdrawal_requests', {
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
    /** Cashier handling the request (NULL while still in 'pending'). */
    cashier_id: {
      type: 'uuid',
      references: 'users(id)',
      onDelete: 'SET NULL',
    },
    amount: {
      type: 'numeric(18,2)',
      notNull: true,
      check: 'amount > 0',
    },
    currency: { type: 'text', notNull: true, default: 'ETB' },
    /** User's Telebirr number to receive the payout. Stored canonical
     *  (0XXXXXXXXX) per the existing parser convention. */
    telebirr_number: { type: 'text', notNull: true },
    /** Account name as the user typed it; cashier double-checks before
     *  hitting send. */
    account_name: { type: 'text', notNull: true },
    /** Telebirr ref of the OUTGOING transfer the cashier initiated.
     *  Captured at completion time. */
    telebirr_ref: { type: 'text' },
    status: {
      type: 'text',
      notNull: true,
      default: 'pending',
      check:
        "status IN ('pending','processing','completed','rejected','cancelled','failed')",
    },
    /** The wallet ledger row that debited the user when the request
     *  was created. Used to drive any reversal on reject/fail. */
    debit_transaction_id: {
      type: 'uuid',
      references: 'transactions(id)',
      onDelete: 'SET NULL',
    },
    /** When debit reversal happens, captures the new credit row. */
    reversal_transaction_id: {
      type: 'uuid',
      references: 'transactions(id)',
      onDelete: 'SET NULL',
    },
    notes: { type: 'text' },
    requested_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    processed_at: { type: 'timestamptz' },
    completed_at: { type: 'timestamptz' },
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

  pgm.createIndex('telebirr_withdrawal_requests', 'tenant_id');
  pgm.createIndex('telebirr_withdrawal_requests', 'user_id');
  pgm.createIndex('telebirr_withdrawal_requests', 'cashier_id');
  pgm.createIndex('telebirr_withdrawal_requests', 'status');
  pgm.createIndex('telebirr_withdrawal_requests', 'created_at');
  pgm.createIndex('telebirr_withdrawal_requests', [
    'tenant_id',
    'status',
    'created_at',
  ]);
  pgm.createIndex('telebirr_withdrawal_requests', 'telebirr_ref');
  // Partial unique: at most one open request per user. 'pending' and
  // 'processing' both block creating another; final-state rows
  // ('completed','rejected','cancelled','failed') don't.
  pgm.sql(`
    CREATE UNIQUE INDEX telebirr_withdrawal_user_open_uniq
      ON telebirr_withdrawal_requests (tenant_id, user_id)
      WHERE status IN ('pending','processing')
  `);

  pgm.sql(`
    CREATE TRIGGER telebirr_withdrawal_requests_set_updated_at
      BEFORE UPDATE ON telebirr_withdrawal_requests
      FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  `);

  pgm.sql(
    `ALTER TABLE telebirr_withdrawal_requests ENABLE ROW LEVEL SECURITY`
  );
  pgm.sql(
    `ALTER TABLE telebirr_withdrawal_requests FORCE ROW LEVEL SECURITY`
  );
  pgm.sql(`
    CREATE POLICY telebirr_withdrawal_tenant_isolation ON telebirr_withdrawal_requests
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
  /* telebirr_agents.last_assigned_at                                        */
  /* ---------------------------------------------------------------------- */
  pgm.addColumn('telebirr_agents', {
    last_assigned_at: { type: 'timestamptz' },
  });
  pgm.createIndex('telebirr_agents', 'last_assigned_at');
};

exports.down = (pgm) => {
  pgm.dropIndex('telebirr_agents', 'last_assigned_at');
  pgm.dropColumn('telebirr_agents', 'last_assigned_at');

  pgm.sql(
    `DROP POLICY IF EXISTS telebirr_withdrawal_tenant_isolation ON telebirr_withdrawal_requests`
  );
  pgm.sql(
    `DROP TRIGGER IF EXISTS telebirr_withdrawal_requests_set_updated_at ON telebirr_withdrawal_requests`
  );
  pgm.sql(`DROP INDEX IF EXISTS telebirr_withdrawal_user_open_uniq`);
  pgm.dropTable('telebirr_withdrawal_requests');

  pgm.sql(
    `DROP POLICY IF EXISTS payment_methods_tenant_isolation ON payment_methods`
  );
  pgm.sql(
    `DROP TRIGGER IF EXISTS payment_methods_set_updated_at ON payment_methods`
  );
  pgm.dropTable('payment_methods');
};
