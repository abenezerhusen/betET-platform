import { Pool, PoolConfig } from 'pg';
import { env } from '../../config/env';
import { logger } from '../logger';

const config: PoolConfig = {
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: env.PG_POOL_IDLE_MS,
  connectionTimeoutMillis: env.PG_POOL_CONNECTION_TIMEOUT_MS,
  application_name: 'betet-backend',
};

export const pool = new Pool(config);

pool.on('error', (err) => {
  logger.error({ err }, 'unexpected pg pool error');
});

logger.info(
  {
    max: config.max,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
  },
  'pg pool configured'
);

export async function shutdownPool(): Promise<void> {
  await pool.end();
}
