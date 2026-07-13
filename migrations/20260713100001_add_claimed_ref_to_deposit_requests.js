/**
 * P2P deposit — user-submitted Telebirr reference.
 *
 * In the "real reference" P2P flow the player first transfers money to the
 * agent's Telebirr number, then types the **actual Telebirr transaction
 * reference** (the `Ref:` value from their own Telebirr SMS) into the user
 * panel. The backend stores it here and confirms the deposit by matching it
 * against the reference parsed from the agent device's incoming SMS
 * (`telebirr_transactions.telebirr_ref`).
 *
 * This is the most reliable match key (globally unique per Telebirr payment),
 * so the matcher tries it BEFORE the note reference-code / amount strategies.
 *
 * A partial unique index prevents two *open* requests from claiming the same
 * reference at the same time (one payment → one waiting request).
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE telebirr_deposit_requests
      ADD COLUMN IF NOT EXISTS claimed_telebirr_ref text
  `);

  pgm.sql(`
    CREATE INDEX IF NOT EXISTS telebirr_deposit_requests_claimed_ref_idx
      ON telebirr_deposit_requests (tenant_id, claimed_telebirr_ref)
      WHERE claimed_telebirr_ref IS NOT NULL
  `);

  // At most one WAITING request may claim a given reference per tenant.
  pgm.sql(`
    CREATE UNIQUE INDEX IF NOT EXISTS telebirr_deposit_requests_claimed_ref_waiting_uniq
      ON telebirr_deposit_requests (tenant_id, claimed_telebirr_ref)
      WHERE claimed_telebirr_ref IS NOT NULL AND status = 'waiting'
  `);
};

exports.down = (pgm) => {
  pgm.sql(`DROP INDEX IF EXISTS telebirr_deposit_requests_claimed_ref_waiting_uniq`);
  pgm.sql(`DROP INDEX IF EXISTS telebirr_deposit_requests_claimed_ref_idx`);
  pgm.sql(`ALTER TABLE telebirr_deposit_requests DROP COLUMN IF EXISTS claimed_telebirr_ref`);
};
