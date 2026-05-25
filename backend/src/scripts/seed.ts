import { logger } from '../infrastructure/logger';
import { withTenantClient } from '../infrastructure/db/tenant-client';
import { runSeed } from './seed.data';

async function main(): Promise<void> {
  await withTenantClient({ tenantId: null, bypassRls: true }, async (client) => {
    await runSeed(client);
  });
  logger.info('seed: default local data ready');
  logger.info('login: superadmin@playcore.local / Admin@123456');
  logger.info('login: admin@playcore.local / Admin@123456');
  logger.info('login: cashier@playcore.local / Admin@123456');
  logger.info('login: user@playcore.local / Admin@123456 (ETB 5,000)');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'seed failed');
    process.exit(1);
  });
