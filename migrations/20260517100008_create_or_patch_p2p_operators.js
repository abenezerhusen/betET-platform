exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS p2p_operators (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id          UUID REFERENCES users(id),
      role             VARCHAR(20) CHECK (role IN ('admin','operator','client')),
      assigned_wallets UUID[],
      status           VARCHAR(20) DEFAULT 'active'
                       CHECK (status IN ('active','suspended')),
      access_token     VARCHAR(255) UNIQUE,
      token_expires    TIMESTAMPTZ,
      token_sent_to    VARCHAR(255),
      last_login_at    TIMESTAMPTZ,
      permissions      JSONB,
      created_at       TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Compatibility for existing admin-domain p2p_operators table shape.
  pgm.sql(`ALTER TABLE p2p_operators ADD COLUMN IF NOT EXISTS assigned_wallets UUID[];`);
  pgm.sql(`ALTER TABLE p2p_operators ADD COLUMN IF NOT EXISTS access_token VARCHAR(255);`);
  pgm.sql(`ALTER TABLE p2p_operators ADD COLUMN IF NOT EXISTS token_expires TIMESTAMPTZ;`);
  pgm.sql(`ALTER TABLE p2p_operators ADD COLUMN IF NOT EXISTS token_sent_to VARCHAR(255);`);
  pgm.sql(`ALTER TABLE p2p_operators ADD COLUMN IF NOT EXISTS permissions JSONB;`);
};

exports.down = () => {};
