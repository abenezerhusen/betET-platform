exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS p2p_linked_accounts (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id  UUID NOT NULL REFERENCES p2p_devices(id) ON DELETE CASCADE,
      phone      VARCHAR(20) NOT NULL,
      label      VARCHAR(100),
      enabled    BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
};

exports.down = () => {};
