/**
 * Sports data provider — results/settlement runtime state (ADDITIVE ONLY).
 *
 * Adds counters + timestamp for the dedicated results/auto-settlement sync
 * phase so the admin dashboard can show, at a glance, when results were last
 * synchronized and how many events/tickets the engine has processed. No
 * existing column is touched; defaults keep every existing row valid.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('sports_data_provider', {
    last_results_sync_at: { type: 'timestamptz', notNull: false },
    results_finalized: { type: 'bigint', notNull: true, default: 0 },
    tickets_settled: { type: 'bigint', notNull: true, default: 0 },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('sports_data_provider', [
    'last_results_sync_at',
    'results_finalized',
    'tickets_settled',
  ]);
};
