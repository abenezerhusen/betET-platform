/**
 * audit_logs
 *  - Immutable trail of admin/cashier/user/system actions.
 *  - tenant_id is nullable to allow truly global/system events; those rows
 *    are only visible when app_is_bypass_rls() is on.
 *  - Append-only: no updated_at, no UPDATE policy needed (writes go through
 *    INSERT, and FOR ALL covers SELECT/INSERT/UPDATE/DELETE under the same
 *    isolation predicate).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('audit_logs', {
    id: {
      type: 'uuid',
      primaryKey: true,
      default: pgm.func('gen_random_uuid()'),
    },
    tenant_id: {
      type: 'uuid',
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    actor_id: { type: 'uuid' },
    actor_type: { type: 'text' },
    action: { type: 'text', notNull: true },
    resource: { type: 'text', notNull: true },
    resource_id: { type: 'text' },
    payload: {
      type: 'jsonb',
      notNull: true,
      default: pgm.func("'{}'::jsonb"),
    },
    ip: { type: 'inet' },
    user_agent: { type: 'text' },
    status: { type: 'text', notNull: true, default: 'success' },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('audit_logs', 'audit_logs_status_check', {
    check: "status IN ('success','failure','warning','info')",
  });

  pgm.createIndex('audit_logs', 'tenant_id');
  pgm.createIndex('audit_logs', 'actor_id');
  pgm.createIndex('audit_logs', 'action');
  pgm.createIndex('audit_logs', 'resource');
  pgm.createIndex('audit_logs', 'resource_id');
  pgm.createIndex('audit_logs', 'status');
  pgm.createIndex('audit_logs', 'created_at');
  pgm.createIndex('audit_logs', ['tenant_id', 'created_at']);
  pgm.createIndex('audit_logs', ['tenant_id', 'resource', 'resource_id']);
  pgm.createIndex('audit_logs', ['tenant_id', 'action', 'created_at']);

  pgm.sql(`ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY`);

  pgm.sql(`
    CREATE POLICY audit_logs_tenant_isolation ON audit_logs
    FOR ALL
    USING (
      app_is_bypass_rls()
      OR (tenant_id IS NOT NULL AND tenant_id = get_tenant_context())
    )
    WITH CHECK (
      app_is_bypass_rls()
      OR (tenant_id IS NOT NULL AND tenant_id = get_tenant_context())
    );
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP POLICY IF EXISTS audit_logs_tenant_isolation ON audit_logs`);
  pgm.dropTable('audit_logs');
};
