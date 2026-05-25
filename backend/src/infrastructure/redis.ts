import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

let client: Redis | null = null;
let initFailed = false;

/**
 * Lazily construct a single ioredis client when REDIS_URL is set. When the
 * variable is unset we never instantiate a client and the cache layer falls
 * back to its in-memory store (see infrastructure/cache.ts).
 */
export function getRedis(): Redis | null {
  if (client || initFailed) return client;
  if (!env.REDIS_URL) return null;

  try {
    client = new Redis(env.REDIS_URL, {
      keyPrefix: env.REDIS_KEY_PREFIX,
      lazyConnect: false,
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
      // Don't crash the process if Redis is briefly unreachable; the cache
      // layer treats every error as a miss.
      reconnectOnError: () => true,
    });
    client.on('error', (err) => {
      logger.error({ err }, 'redis error');
    });
    client.on('connect', () => {
      logger.info({ url: maskUrl(env.REDIS_URL!) }, 'redis connected');
    });
    return client;
  } catch (err) {
    initFailed = true;
    logger.error({ err }, 'failed to initialize redis client; using in-memory cache');
    return null;
  }
}

export async function shutdownRedis(): Promise<void> {
  if (!client) return;
  try {
    await client.quit();
  } catch (err) {
    logger.warn({ err }, 'error during redis shutdown');
  } finally {
    client = null;
  }
}

function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '***';
  }
}
