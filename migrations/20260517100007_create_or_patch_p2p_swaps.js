exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS p2p_swaps (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id   UUID NOT NULL REFERENCES p2p_devices(id),
      swap_type   VARCHAR(20) CHECK (swap_type IN ('top_up','withdrawal')),
      amount      DECIMAL(18,2) NOT NULL,
      source      VARCHAR(20) CHECK (source IN ('Top-Up','Withdrawal')),
      status      VARCHAR(20) DEFAULT 'pending'
                  CHECK (status IN ('added','pending','failed')),
      operator_id UUID REFERENCES users(id),
      note        TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Compatibility for existing admin-domain p2p_swaps table shape.
  pgm.sql(`ALTER TABLE p2p_swaps ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES p2p_devices(id);`);
  pgm.sql(`ALTER TABLE p2p_swaps ADD COLUMN IF NOT EXISTS swap_type VARCHAR(20);`);
};

exports.down = () => {};
