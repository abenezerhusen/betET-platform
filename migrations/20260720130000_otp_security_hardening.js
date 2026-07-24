/**
 * OTP security hardening (additive).
 *
 * Extends `notification_otps` (created in 20260720120000) so it doubles as
 * the OTP security log required by the spec, and to support:
 *
 *   - lifecycle status  → pending | verified | used | expired | failed
 *   - one-time-use       (consumed_at already exists; status makes it explicit)
 *   - resend protection  → resend_count + resend_blocked_until
 *   - verify protection  → attempts (exists) + verify_blocked_until
 *   - security logging    → user_id, provider, device_info, verified_at
 *
 * The plaintext code is NEVER stored — only its SHA-256 hash (code_hash,
 * already present). This migration touches no other table and is safe to
 * roll back independently.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('notification_otps', {
    /** pending | verified | used | expired | failed. */
    status: { type: 'text', notNull: true, default: 'pending' },
    /** Resolved user this OTP belongs to (nullable for registration). */
    user_id: { type: 'uuid', references: 'users(id)', onDelete: 'SET NULL' },
    /** Provider slug actually used to deliver (e.g. 'sms', 'telegram'). */
    provider: { type: 'text' },
    /** How many sends happened in the current rolling resend window. */
    resend_count: { type: 'integer', notNull: true, default: 0 },
    /** When set and in the future, new OTP requests are blocked. */
    resend_blocked_until: { type: 'timestamptz' },
    /** When set and in the future, verification attempts are blocked. */
    verify_blocked_until: { type: 'timestamptz' },
    /** Timestamp of a successful verification. */
    verified_at: { type: 'timestamptz' },
    /** Device / user-agent string captured for fraud monitoring. */
    device_info: { type: 'text' },
  });

  pgm.createIndex('notification_otps', ['tenant_id', 'user_id']);
  pgm.createIndex('notification_otps', ['tenant_id', 'purpose', 'identifier', 'status']);
};

exports.down = (pgm) => {
  pgm.dropIndex('notification_otps', ['tenant_id', 'purpose', 'identifier', 'status']);
  pgm.dropIndex('notification_otps', ['tenant_id', 'user_id']);
  pgm.dropColumns('notification_otps', [
    'status',
    'user_id',
    'provider',
    'resend_count',
    'resend_blocked_until',
    'verify_blocked_until',
    'verified_at',
    'device_info',
  ]);
};
