/**
 * telebirr_deposit_requests
 *  - When a player wants to deposit, the user panel calls
 *    `POST /api/user/wallet/telebirr/request` (TBD) which creates a row
 *    here and returns:
 *      { telebirr_number, reference_code, expires_at }
 *  - The player initiates a Telebirr transfer to telebirr_number and
 *    pastes reference_code into the Telebirr "note / reason" field.
 *  - When the Flutter agent device reports the matching SMS, the
 *    backend matcher links it via reference_code (or, fallback, by
 *    sender_phone + amount within the validity window).
 *  - status lifecycle:
 *      waiting   -> awaiting payment, before expires_at
 *      confirmed -> matched to a telebirr_transactions row, user
 *                   credited
 *      expired   -> expires_at passed without a match
 *      cancelled -> user/admin closed the request
 *  - matched_transaction_id points at the telebirr_transactions row
 *    that fulfilled the request.
 *
 *  Note on uniqueness of reference_code: the spec asks for an index
 *  only, so the backend will be responsible for generating codes that
 *  are unique among rows with status='waiting'. Promote to a partial
 *  unique index later if we want the database to enforce it.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('telebirr_deposit_requests', {
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
    // User spec used `decimal` (unbounded) here; preserved verbatim.
    amount: { type: 'numeric', notNull: true },
    telebirr_number: { type: 'text', notNull: true },
    reference_code: { type: 'varchar(8)', notNull: true },
    expires_at: { type: 'timestamptz', notNull: true },
    status: { type: 'text', notNull: true, default: 'waiting' },
    matched_transaction_id: {
      type: 'uuid',
      references: 'telebirr_transactions(id)',
      onDelete: 'SET NULL',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint(
    'telebirr_deposit_requests',
    'telebirr_deposit_requests_status_check',
    {
      check: "status IN ('waiting','confirmed','expired','cancelled')",
    }
  );
  pgm.addConstraint(
    'telebirr_deposit_requests',
    'telebirr_deposit_requests_amount_positive',
    { check: 'amount > 0' }
  );

  pgm.createIndex('telebirr_deposit_requests', 'tenant_id');
  pgm.createIndex('telebirr_deposit_requests', 'reference_code');
  pgm.createIndex('telebirr_deposit_requests', 'user_id');
  pgm.createIndex('telebirr_deposit_requests', 'status');
  pgm.createIndex('telebirr_deposit_requests', 'expires_at');
  pgm.createIndex('telebirr_deposit_requests', 'created_at');
  pgm.createIndex('telebirr_deposit_requests', ['tenant_id', 'status']);
  pgm.createIndex('telebirr_deposit_requests', ['user_id', 'status']);

  pgm.sql(`ALTER TABLE telebirr_deposit_requests ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE telebirr_deposit_requests FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY telebirr_deposit_requests_tenant_isolation
      ON telebirr_deposit_requests
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
    `DROP POLICY IF EXISTS telebirr_deposit_requests_tenant_isolation ON telebirr_deposit_requests`
  );
  pgm.dropTable('telebirr_deposit_requests');
};
