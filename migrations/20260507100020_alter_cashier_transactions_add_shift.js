/**
 * Link cashier_transactions to a cashier_shifts row so shift reports can
 * aggregate the period cleanly. Nullable for historical rows pre-shifts.
 */

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.addColumns('cashier_transactions', {
    shift_id: {
      type: 'uuid',
      references: 'cashier_shifts(id)',
      onDelete: 'SET NULL',
    },
  });

  pgm.createIndex('cashier_transactions', 'shift_id');
  pgm.createIndex('cashier_transactions', ['tenant_id', 'shift_id']);
};

exports.down = (pgm) => {
  pgm.dropIndex('cashier_transactions', ['tenant_id', 'shift_id']);
  pgm.dropIndex('cashier_transactions', 'shift_id');
  pgm.dropColumns('cashier_transactions', ['shift_id']);
};
