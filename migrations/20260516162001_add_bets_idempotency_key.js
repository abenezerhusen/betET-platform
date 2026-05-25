/**
 * Add idempotency key to bets for duplicate protection.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumn('bets', {
    idempotency_key: { type: 'text' },
  });

  pgm.createIndex('bets', ['tenant_id', 'user_id', 'idempotency_key', 'placed_at'], {
    name: 'bets_tenant_user_idempotency_idx',
    where: 'idempotency_key IS NOT NULL',
  });
};

exports.down = (pgm) => {
  pgm.dropIndex('bets', ['tenant_id', 'user_id', 'idempotency_key', 'placed_at'], {
    name: 'bets_tenant_user_idempotency_idx',
    ifExists: true,
  });
  pgm.dropColumn('bets', 'idempotency_key');
};
