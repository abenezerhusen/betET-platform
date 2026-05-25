/**
 * Bootstrap migration:
 *  - Required extensions (pgcrypto for gen_random_uuid, citext for case-insensitive text)
 *  - Tenant context helpers (set / get / clear)
 *  - RLS bypass helper for superadmin / cross-tenant operations
 *  - touch_updated_at() trigger function reused by all tables with updated_at
 *
 * All tenant-scoped tables enable Row Level Security (RLS) and read tenant
 * context via get_tenant_context(). The application MUST call
 *   SELECT set_tenant_context($1);
 * at the start of each request/transaction. For superadmin cross-tenant
 * operations, additionally call:
 *   SELECT set_bypass_rls(true);
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
  pgm.sql(`CREATE EXTENSION IF NOT EXISTS citext`);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_tenant_context(p_tenant_id uuid, p_local boolean DEFAULT true)
    RETURNS void AS $$
    BEGIN
      PERFORM set_config('app.tenant_id', COALESCE(p_tenant_id::text, ''), p_local);
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION get_tenant_context()
    RETURNS uuid AS $$
    BEGIN
      RETURN NULLIF(current_setting('app.tenant_id', true), '')::uuid;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
    $$ LANGUAGE plpgsql STABLE;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION clear_tenant_context()
    RETURNS void AS $$
    BEGIN
      PERFORM set_config('app.tenant_id', '', true);
      PERFORM set_config('app.bypass_rls', 'off', true);
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION set_bypass_rls(p_enabled boolean, p_local boolean DEFAULT true)
    RETURNS void AS $$
    BEGIN
      PERFORM set_config('app.bypass_rls', CASE WHEN p_enabled THEN 'on' ELSE 'off' END, p_local);
    END;
    $$ LANGUAGE plpgsql;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION app_is_bypass_rls()
    RETURNS boolean AS $$
    BEGIN
      RETURN current_setting('app.bypass_rls', true) = 'on';
    EXCEPTION WHEN others THEN
      RETURN false;
    END;
    $$ LANGUAGE plpgsql STABLE;
  `);

  pgm.sql(`
    CREATE OR REPLACE FUNCTION touch_updated_at()
    RETURNS trigger AS $$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP FUNCTION IF EXISTS touch_updated_at()`);
  pgm.sql(`DROP FUNCTION IF EXISTS app_is_bypass_rls()`);
  pgm.sql(`DROP FUNCTION IF EXISTS set_bypass_rls(boolean, boolean)`);
  pgm.sql(`DROP FUNCTION IF EXISTS clear_tenant_context()`);
  pgm.sql(`DROP FUNCTION IF EXISTS get_tenant_context()`);
  pgm.sql(`DROP FUNCTION IF EXISTS set_tenant_context(uuid, boolean)`);
};
