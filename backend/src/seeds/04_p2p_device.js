exports.seed = async function seed(knex) {
  await knex('p2p_devices').del();

  await knex('p2p_devices').insert([
    {
      id: '00000000-0000-0000-0001-000000000001',
      label: 'Main Agent Wallet',
      telebirr_phone: '+251912345678',
      device_token: 'dev_token_change_this_in_production',
      status: 'offline',
      pre_deposit: 50000,
      commission_rate: 0.02,
      daily_limit: 100000,
    },
  ]);

  // eslint-disable-next-line no-console
  console.log('✅ P2P device seeded');
  // eslint-disable-next-line no-console
  console.log('   Phone: +251912345678');
  // eslint-disable-next-line no-console
  console.log('   Token: dev_token_change_this_in_production');
  // eslint-disable-next-line no-console
  console.log('   → Use this token in Flutter app for local testing');
};
