/**
 * telebirr_agents.ussd_pin_encrypted
 *
 * Stores the Telebirr USSD PIN for a wallet device, sealed with the
 * AES-256-GCM secret cipher (never stored or echoed in plaintext). The
 * backend decrypts it only when building the ready-to-dial USSD string
 * embedded in a `withdraw` command payload so the phone app can execute
 * the payout automatically.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('telebirr_agents', {
    ussd_pin_encrypted: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('telebirr_agents', 'ussd_pin_encrypted');
};
