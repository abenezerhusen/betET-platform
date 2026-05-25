exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS p2p_commissions (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id        UUID REFERENCES p2p_devices(id),
      client_user_id   UUID REFERENCES users(id),
      deposit_rate     DECIMAL(5,4) NOT NULL DEFAULT 0.02,
      withdrawal_rate  DECIMAL(5,4) NOT NULL DEFAULT 0.02,
      processed_today  DECIMAL(18,2) DEFAULT 0,
      earned_today     DECIMAL(18,2) DEFAULT 0,
      created_at       TIMESTAMPTZ DEFAULT NOW(),
      updated_at       TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Compatibility for existing admin-domain p2p_commissions table shape.
  pgm.sql(`ALTER TABLE p2p_commissions ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES p2p_devices(id);`);
  pgm.sql(`ALTER TABLE p2p_commissions ADD COLUMN IF NOT EXISTS client_user_id UUID REFERENCES users(id);`);
  pgm.sql(`ALTER TABLE p2p_commissions ADD COLUMN IF NOT EXISTS deposit_rate DECIMAL(5,4) DEFAULT 0.02;`);
  pgm.sql(`ALTER TABLE p2p_commissions ADD COLUMN IF NOT EXISTS withdrawal_rate DECIMAL(5,4) DEFAULT 0.02;`);
  pgm.sql(`ALTER TABLE p2p_commissions ADD COLUMN IF NOT EXISTS processed_today DECIMAL(18,2) DEFAULT 0;`);
  pgm.sql(`ALTER TABLE p2p_commissions ADD COLUMN IF NOT EXISTS earned_today DECIMAL(18,2) DEFAULT 0;`);
};

exports.down = () => {};
