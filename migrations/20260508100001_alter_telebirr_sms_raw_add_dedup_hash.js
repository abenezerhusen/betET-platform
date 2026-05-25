/**
 * telebirr_sms_raw — add dedup_hash + partial unique index.
 *
 *  Why: the agent batch-upload endpoint
 *    POST /api/agent/sms/batch
 *  must be idempotent. The Flutter device may resend a batch when it
 *  comes back online and isn't sure which messages we accepted. We
 *  derive a stable hash for each message (see backend) and use a
 *  partial unique index here so duplicate batch entries cannot insert
 *  twice — even under concurrent uploads from the same device.
 *
 *  The index is partial (`WHERE dedup_hash IS NOT NULL`) so:
 *    - rows uploaded by the SINGLE-message endpoint, which intentionally
 *      does NOT compute a dedup_hash (always-store-on-arrival policy),
 *      are unaffected,
 *    - any historical rows from before this migration (none exist at
 *      time of writing — the table is newly created in migration 22)
 *      cannot collide with new inserts.
 *
 *  Scope of uniqueness: (tenant_id, agent_id, dedup_hash). We scope by
 *  agent because the SMS source is the device — the same SMS body
 *  arriving from two different agents is two real messages, not a
 *  duplicate. We also include tenant_id as defence-in-depth (RLS
 *  already isolates tenants but uniqueness in Postgres is enforced at
 *  table level, not policy level).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('telebirr_sms_raw', {
    dedup_hash: { type: 'text' },
  });
  pgm.sql(`
    CREATE UNIQUE INDEX telebirr_sms_raw_dedup_uniq
      ON telebirr_sms_raw (tenant_id, agent_id, dedup_hash)
      WHERE dedup_hash IS NOT NULL
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS telebirr_sms_raw_dedup_uniq`);
  pgm.dropColumns('telebirr_sms_raw', ['dedup_hash']);
};
