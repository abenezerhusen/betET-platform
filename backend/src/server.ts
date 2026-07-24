import { createApp } from './app';
import { env } from './config/env';
import { logger } from './infrastructure/logger';
import {
  preloadTenantOrigins,
  startTenantOriginsRefresh,
  stopTenantOriginsRefresh,
} from './config/cors';
import { shutdownPool } from './infrastructure/db/pool';
import { initSocketServer, shutdownSocketServer } from './realtime/socket';
import { shutdownRedis } from './infrastructure/redis';
import { startAviatorLoop, stopAviatorLoop } from './workers/aviator-loop';
import { startKenoLoop, stopKenoLoop } from './workers/keno-loop';
import { startJetxLoop, stopJetxLoop } from './workers/jetx-loop';
import { startCashbackLoop, stopCashbackLoop } from './workers/cashback-loop';
import { startSettlementLoop, stopSettlementLoop } from './workers/settlement-loop';
import {
  startNotificationLoop,
  stopNotificationLoop,
} from './workers/notification-loop';
import { startBulkSmsLoop, stopBulkSmsLoop } from './workers/bulk-sms-loop';

async function main(): Promise<void> {
  // Preload tenant CORS origins at boot so the first request isn't blocked.
  // Failures here are non-fatal — global CORS_ALLOWED_ORIGINS still works.
  await preloadTenantOrigins().catch((err) => {
    logger.warn({ err }, 'failed to preload tenant CORS origins; continuing');
  });

  const app = createApp();

  const server = app.listen(env.PORT, env.HOST, () => {
    logger.info(
      { port: env.PORT, host: env.HOST, env: env.NODE_ENV },
      'server listening'
    );
  });

  // Attach Socket.io to the same HTTP server so it shares the port and
  // upgrade handling with Express.
  initSocketServer(server);
  startAviatorLoop();
  startKenoLoop();
  startJetxLoop();
  startCashbackLoop();
  startSettlementLoop();
  startNotificationLoop();
  startBulkSmsLoop();

  startTenantOriginsRefresh();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutdown signal received');
    stopTenantOriginsRefresh();
    try {
      stopAviatorLoop();
      stopKenoLoop();
      stopJetxLoop();
      stopCashbackLoop();
      stopSettlementLoop();
      stopNotificationLoop();
      stopBulkSmsLoop();
      await shutdownSocketServer();
      logger.info('socket.io server closed');
    } catch (err) {
      logger.error({ err }, 'error closing socket.io');
    }
    server.close(() => {
      logger.info('http server closed');
    });
    try {
      await shutdownPool();
      logger.info('pg pool closed');
    } catch (err) {
      logger.error({ err }, 'error closing pg pool');
    }
    try {
      await shutdownRedis();
    } catch (err) {
      logger.error({ err }, 'error closing redis');
    }
    // Give pino a moment to flush, then exit.
    setTimeout(() => process.exit(0), 200).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandledRejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaughtException');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'fatal startup error');
  process.exit(1);
});
