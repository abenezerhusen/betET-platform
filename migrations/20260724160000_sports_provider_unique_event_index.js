/**
 * Sports data provider — fast idempotent bulk upsert support (ADDITIVE ONLY).
 *
 * Adds a UNIQUE partial index on the provider event id so the sync layer can
 * upsert thousands of fixtures in a single `INSERT ... ON CONFLICT` statement
 * (needed once we import ALL leagues, not just a 72h window). The index only
 * covers rows that actually carry a provider_event_id, so existing seed / mock
 * fixtures are completely unaffected.
 *
 * The older non-unique lookup index from 20260724140000 is dropped in favour of
 * this unique one (same expression) to avoid maintaining two identical indexes.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Drop the non-unique lookup index (superseded by the unique one below).
  pgm.sql(`DROP INDEX IF EXISTS sports_events_provider_event_idx`);
  // Unique per-tenant provider event id. Partial → only provider-sourced rows.
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS sports_events_provider_event_uidx
      ON sports_events (tenant_id, (metadata->>'provider_event_id'))
      WHERE metadata ? 'provider_event_id'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS sports_events_provider_event_uidx`);
  pgm.sql(`
    CREATE INDEX IF NOT EXISTS sports_events_provider_event_idx
      ON sports_events ((metadata->>'provider_event_id'))
      WHERE metadata ? 'provider_event_id'
  `);
};
