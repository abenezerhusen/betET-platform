exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS p2p_commands (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      device_id    UUID NOT NULL REFERENCES p2p_devices(id),
      command_type VARCHAR(50) NOT NULL
                   CHECK (command_type IN (
                     'check_balance','withdraw',
                     'restart_device','force_heartbeat'
                   )),
      payload      JSONB,
      reference    VARCHAR(100),
      status       VARCHAR(20) DEFAULT 'pending'
                   CHECK (status IN ('pending','sent','executing','success','failed')),
      issued_by    UUID REFERENCES users(id),
      issued_at    TIMESTAMPTZ DEFAULT NOW(),
      executed_at  TIMESTAMPTZ,
      result       JSONB,
      created_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Compatibility for existing admin-domain p2p_commands table shape.
  pgm.sql(`ALTER TABLE p2p_commands ADD COLUMN IF NOT EXISTS device_id UUID REFERENCES p2p_devices(id);`);
  pgm.sql(`ALTER TABLE p2p_commands ADD COLUMN IF NOT EXISTS command_type VARCHAR(50);`);
  pgm.sql(`ALTER TABLE p2p_commands ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ DEFAULT NOW();`);
  pgm.sql(`ALTER TABLE p2p_commands ADD COLUMN IF NOT EXISTS executed_at TIMESTAMPTZ;`);
};

exports.down = () => {};
