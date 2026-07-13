/**
 * P2P deposit — user-uploaded payment screenshot.
 *
 * The player's P2P deposit flow captures the Telebirr payment screenshot
 * (the "127" confirmation) alongside the amount and the claimed reference.
 * It is stored here as evidence so the backend/operator can verify the
 * transfer against the agent's received SMS when the reference alone does
 * not auto-match.
 *
 * Following the existing convention in this codebase (settings logos/banners
 * are stored inline), the value is a base64 data URL. It is intentionally
 * excluded from the hot `SELECT_DEPOSIT_REQUEST` projection so status polls
 * and the matcher never pull the blob; it is read on demand for review.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE telebirr_deposit_requests
      ADD COLUMN IF NOT EXISTS screenshot_url text
  `);
};

exports.down = (pgm) => {
  pgm.sql(`ALTER TABLE telebirr_deposit_requests DROP COLUMN IF EXISTS screenshot_url`);
};
