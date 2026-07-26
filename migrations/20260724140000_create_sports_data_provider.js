/**
 * Sports data provider integration (Odds-API.io) — ADDITIVE ONLY.
 *
 * This migration adds ONE new tenant-scoped table plus ONE lookup index on the
 * EXISTING `sports_events` table. It never alters or drops any existing column
 * and never touches `sports_markets`, `sports_selections`, betting, wallet,
 * payment or auth structures. When `DATA_PROVIDER=mock` (the default) nothing
 * introduced here is ever read or written — the platform behaves exactly as
 * before.
 *
 *   - sports_data_provider → one row per tenant holding the real-data provider
 *     configuration (enabled flag, sealed API key, bookmaker, which sports /
 *     leagues to import, sync intervals, request budget) AND the runtime sync
 *     state surfaced in the admin panel (status, last sync time, last error,
 *     counts). The API key is stored sealed (AES-256-GCM) and never echoed.
 *
 *   - idx sports_events_provider_event_idx → fast idempotent upsert lookup by
 *     the provider's event id, which the sync writes into
 *     sports_events.metadata->>'provider_event_id'. Partial (only rows that
 *     actually carry a provider id) so existing mock/seed rows are unaffected.
 */

exports.shorthands = undefined;

const tenantPolicy = (pgm, table) => {
  pgm.sql(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
  pgm.sql(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
  pgm.sql(`
    CREATE POLICY ${table}_tenant_isolation ON ${table}
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

exports.up = (pgm) => {
  pgm.createTable('sports_data_provider', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    tenant_id: {
      type: 'uuid',
      notNull: true,
      references: 'tenants(id)',
      onDelete: 'CASCADE',
    },
    /** Provider key. Currently only 'odds_api'; 'mock' is handled by env. */
    provider: { type: 'text', notNull: true, default: 'odds_api' },
    /** Master enable flag. The worker also requires env DATA_PROVIDER=odds_api. */
    enabled: { type: 'boolean', notNull: true, default: false },
    api_url: { type: 'text', notNull: true, default: 'https://api.odds-api.io/v3' },
    /** AES-256-GCM sealed API key — plaintext is NEVER stored or echoed. */
    api_key_sealed: { type: 'text' },
    /**
     * Single source bookmaker whose prices feed the platform odds (e.g.
     * Bet365, 1xBet). Odds-API.io returns odds per bookmaker; we pick one.
     */
    bookmaker: { type: 'text', notNull: true, default: 'Bet365' },
    /** Sport slugs to import (Odds-API.io slugs, e.g. football, basketball). */
    sports: { type: 'text[]', notNull: true, default: pgm.func("'{football,basketball}'::text[]") },
    /**
     * Optional league-slug allow-list. NULL / empty = import every league the
     * provider returns for the selected sports.
     */
    leagues: { type: 'text[]' },
    /** How often to refresh prematch fixtures + odds, in seconds. */
    prematch_interval_seconds: { type: 'integer', notNull: true, default: 900 },
    /** How often to refresh live fixtures + odds, in seconds. */
    live_interval_seconds: { type: 'integer', notNull: true, default: 120 },
    /** Provider plan request budget (upgradeable). Sync throttles to stay under. */
    max_requests_per_hour: { type: 'integer', notNull: true, default: 100 },
    /** Only fetch odds for prematch fixtures kicking off within this window. */
    sync_window_hours: { type: 'integer', notNull: true, default: 72 },
    /** 'idle' | 'syncing' | 'ok' | 'error'. */
    status: { type: 'text', notNull: true, default: 'idle' },
    last_run_at: { type: 'timestamptz' },
    last_success_at: { type: 'timestamptz' },
    last_error: { type: 'text' },
    last_events_sync_at: { type: 'timestamptz' },
    events_synced: { type: 'integer', notNull: true, default: 0 },
    odds_synced: { type: 'integer', notNull: true, default: 0 },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_by: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
  });
  // One provider config row per tenant.
  pgm.addConstraint('sports_data_provider', 'sports_data_provider_tenant_uniq', {
    unique: ['tenant_id'],
  });
  pgm.sql(`
    CREATE TRIGGER sports_data_provider_touch_updated_at
    BEFORE UPDATE ON sports_data_provider
    FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
  `);
  tenantPolicy(pgm, 'sports_data_provider');

  // Idempotent-upsert lookup by the provider event id stored in metadata.
  // Partial index → existing seed/mock fixtures (no provider_event_id) are
  // not indexed and are completely unaffected.
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS sports_events_provider_event_idx
      ON sports_events ((metadata->>'provider_event_id'))
      WHERE metadata ? 'provider_event_id'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS sports_events_provider_event_idx`);
  pgm.sql(`DROP TRIGGER IF EXISTS sports_data_provider_touch_updated_at ON sports_data_provider`);
  pgm.sql(`DROP POLICY IF EXISTS sports_data_provider_tenant_isolation ON sports_data_provider`);
  pgm.dropTable('sports_data_provider');
};
