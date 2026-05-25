/**
 * Section 10 — Monitoring
 *
 *  1. system_notification_reads
 *     Per-admin "read" receipt for system_notifications. The notification
 *     row's read_count column is still incremented globally, but this
 *     table lets the UI render a "Mark as read" action that is meaningful
 *     per individual admin (so an alert seen by Admin A still appears as
 *     "unread" to Admin B until they explicitly dismiss it).
 *
 *     PRIMARY KEY (notification_id, user_id) — idempotent: marking the
 *     same notification read twice is a no-op.
 *
 *  2. audit_logs immutability guard
 *     The original migration documented audit_logs as "append-only" but
 *     didn't actually block UPDATE/DELETE at the database layer. Section
 *     10 explicitly requires that the Audit Trail "cannot be deleted or
 *     modified — immutable log". A simple BEFORE trigger now rejects any
 *     UPDATE or DELETE against audit_logs, regardless of role or RLS.
 *
 *     The trigger is bypassed only for transactions that explicitly opt
 *     out via the session GUC app.audit_logs_immutability_bypass = 'on'.
 *     No application code sets that GUC; it exists strictly as an escape
 *     hatch for one-off DBA-driven retention purges (which must be done
 *     via psql with explicit operator action).
 */

exports.shorthands = undefined;

exports.up = async (pgm) => {
  pgm.createTable('system_notification_reads', {
    notification_id: {
      type: 'uuid',
      notNull: true,
      references: 'system_notifications(id)',
      onDelete: 'CASCADE',
    },
    user_id: {
      type: 'uuid',
      notNull: true,
      references: 'users(id)',
      onDelete: 'CASCADE',
    },
    read_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('system_notification_reads', 'system_notification_reads_pkey', {
    primaryKey: ['notification_id', 'user_id'],
  });
  pgm.createIndex('system_notification_reads', 'user_id');
  pgm.createIndex('system_notification_reads', 'read_at');

  // No tenant_id on this row: the notification's tenant is enforced by
  // the join with system_notifications (which IS RLS-isolated). All
  // service-layer access to this table goes through withTenantClient
  // with bypassRls=true, so we leave RLS off here for simplicity.

  // ----------------------------------------------------------------------
  // audit_logs immutability — block UPDATE / DELETE.
  // ----------------------------------------------------------------------
  pgm.sql(`
    CREATE OR REPLACE FUNCTION audit_logs_block_modification()
    RETURNS TRIGGER AS $$
    BEGIN
      IF current_setting('app.audit_logs_immutability_bypass', true) = 'on' THEN
        RETURN COALESCE(NEW, OLD);
      END IF;
      RAISE EXCEPTION 'audit_logs is append-only and cannot be % (id=%, action=%)',
        TG_OP,
        COALESCE(OLD.id, NEW.id),
        COALESCE(OLD.action, NEW.action)
      USING ERRCODE = 'insufficient_privilege';
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS audit_logs_immutable_update ON audit_logs;
    CREATE TRIGGER audit_logs_immutable_update
      BEFORE UPDATE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION audit_logs_block_modification();
  `);

  pgm.sql(`
    DROP TRIGGER IF EXISTS audit_logs_immutable_delete ON audit_logs;
    CREATE TRIGGER audit_logs_immutable_delete
      BEFORE DELETE ON audit_logs
      FOR EACH ROW EXECUTE FUNCTION audit_logs_block_modification();
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP TRIGGER IF EXISTS audit_logs_immutable_delete ON audit_logs`);
  pgm.sql(`DROP TRIGGER IF EXISTS audit_logs_immutable_update ON audit_logs`);
  pgm.sql(`DROP FUNCTION IF EXISTS audit_logs_block_modification()`);

  pgm.dropTable('system_notification_reads');
};
