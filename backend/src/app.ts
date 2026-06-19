import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import compression from 'compression';
import swaggerUi from 'swagger-ui-express';

import { env } from './config/env';
import { corsOptions } from './config/cors';
import { logger } from './infrastructure/logger';
import { setTenantContextMiddleware } from './middleware/tenant-context';
import { requestMetricsMiddleware } from './middleware/request-metrics';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { generalRateLimiter } from './middleware/rate-limiters';
import authRoutes from './modules/auth/auth.routes';
import adminRoutes from './modules/admin/admin.routes';
import cashierRoutes from './modules/cashier/cashier.routes';
import userRoutes from './modules/user/user.routes';
import gameRoutes from './modules/game/game.routes';
import gamesRoutes from './modules/games/games.routes';
import mobileRoutes from './modules/mobile/mobile.routes';
import agentRoutes from './modules/agent/agent.routes';
import operatorRoutes from './modules/operator/operator.module';
import p2pAliasRoutes from './modules/p2p/p2p-alias.routes';
import p2pUserRoutes from './modules/p2p/p2p-user.routes';
import paymentsAliasRoutes from './modules/payments/payments-alias.routes';
import publicTournamentsRoutes from './modules/tournaments/public-tournaments.routes';
import publicSportsRoutes from './modules/sports/public-sports.routes';
import publicPromotionsRoutes from './modules/promotions/public-promotions.routes';
import publicGamesRoutes from './modules/public/public-games.routes';
// Section 19 — public general / top-bets / top-matches / promotions
import publicGeneralRoutes from './modules/public/public-general.routes';
// Section 16 Flow B — walk-in sportsbook reservation (no auth required)
import publicBetsRoutes from './modules/public/public-bets.routes';
import liveCasinoRoutes from './modules/games/live-casino.routes';
// Section 18 — sportsbook bet placement, cashout, history.
import sportsbookBetsRoutes from './modules/bets/bets.routes';
import internalGamesRoutes from './modules/games/internal-games.routes';
import externalGamesRoutes from './modules/games/external-games.routes';
import externalGamesWebhookRoutes from './modules/webhooks/external-games.webhook.routes';
import embedRoutes from './modules/public/embed.routes';
import swaggerSpec from './swagger';
// Importing the payments barrel registers TelebirrP2PProvider (and any
// future provider) in the in-process providerRegistry at boot.
import './modules/payments';

export function createApp(): Express {
  const app = express();

  // When deployed behind a load balancer / reverse proxy, trust the first
  // X-Forwarded-* hop so req.ip reflects the real client IP. Adjust the
  // hop count via PROXY env if you have multiple proxies in front.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      // Each request gets a unique id; surfaces in every log line so we can
      // correlate slow requests with downstream queries / errors.
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          (typeof incoming === 'string' && incoming) ||
          (Array.isArray(incoming) && incoming[0]) ||
          undefined;
        const finalId = id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        res.setHeader('x-request-id', finalId);
        return finalId;
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      // pino-http already includes responseTime; expose it as a header too
      // so clients (and load balancers) can record server-side latency.
      customSuccessMessage: (req, res, responseTime) =>
        `${req.method} ${req.url} ${res.statusCode} ${responseTime}ms`,
      customErrorMessage: (req, res, err) =>
        `${req.method} ${req.url} ${res.statusCode} (${err.message})`,
    })
  );

  app.use(
    helmet({
      contentSecurityPolicy: false, // API serves JSON only
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
    })
  );

  app.use(cors(corsOptions));
  app.options('*', cors(corsOptions));

  // gzip / brotli on responses >= 1KB. Skip when the client opts out via
  // `x-no-compression`. Reduces wire size for paginated lists and reports.
  app.use(
    compression({
      threshold: 1024,
      filter: (req, res) => {
        if (req.headers['x-no-compression']) return false;
        return compression.filter(req, res);
      },
    })
  );

  // The `verify` callback stashes the raw bytes on `req.rawBody`. Game
  // engine webhooks need the exact payload to recompute HMAC-SHA256
  // signatures byte-for-byte; for every other route the buffer is just
  // a small-ish memory blip per request.
  app.use(
    express.json({
      limit: '25mb',   // allow base64-encoded images in settings (logos, banners, thumbnails)
      verify: (req, _res, buf) => {
        (req as { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(express.urlencoded({ extended: false, limit: '25mb' }));

  // Resolve tenant from header / subdomain and attach to req.tenant. The
  // actual `set_tenant_context()` SQL call happens per-DB-connection inside
  // withTenantClient(), guaranteeing RLS is activated for every query.
  app.use(setTenantContextMiddleware());
  app.use(requestMetricsMiddleware());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'betet-backend', env: env.NODE_ENV });
  });
  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      environment: env.NODE_ENV,
    });
  });
  app.get('/ready', (_req, res) => {
    res.json({ status: 'ready' });
  });

  // Spec: 100 req/min/user general fallback. Per-route limiters (auth,
  // bet placement, admin reports) attach inside their own routers and
  // run *in addition* to this floor. Health/ready are skipped inside
  // the limiter itself.
  app.use(generalRateLimiter);

  app.use('/api/auth', authRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/cashier', cashierRoutes);
  app.use('/api/user', userRoutes);
  // Section 17 spec alias — game-engine pages call `GET /api/users/me`
  // (plural) to read the current player. We re-mount the same user
  // router under the plural prefix so both vocabularies work.
  app.use('/api/users', userRoutes);
  app.use('/api/game', gameRoutes);
  // Section 15 — public internal-games lobby + worker RTP reader. These
  // paths (/lobby, /rtp/:id, /external/list) are intentionally mounted
  // BEFORE the auth-protected gamesRoutes so unauthenticated visitors can
  // load the lobby without a JWT.
  app.use('/api/games', internalGamesRoutes);
  // Section 15 — user-authenticated external game launch + session close.
  app.use('/api/games/external', externalGamesRoutes);
  app.use('/api/games', gamesRoutes);
  app.use('/api/mobile', mobileRoutes);
  app.use('/api/agent', agentRoutes);
  // User-facing P2P endpoints (GET /api/p2p/accounts) must be mounted
  // BEFORE the admin alias so the alias's `requireRole('superadmin','tenant_admin')`
  // gate never sees them.
  app.use('/api/p2p', p2pUserRoutes);
  app.use('/api/p2p', p2pAliasRoutes);
  // Spec alias for /api/payments/deposit/pending and /api/payments/withdraw.
  app.use('/api/payments', paymentsAliasRoutes);
  app.use('/api/operator', operatorRoutes);
  app.use('/api/tournaments', publicTournamentsRoutes);
  app.use('/api/sports', publicSportsRoutes);
  // Section 18 — POST /api/bets/place, /:id/cashout, GET /api/bets/:id
  app.use('/api/bets', sportsbookBetsRoutes);
  app.use('/api/promotions', publicPromotionsRoutes);
  app.use('/api/public/games', publicGamesRoutes);
  // Section 16 Flow B — walk-in sportsbook reservation (no auth)
  app.use('/api/public/bets', publicBetsRoutes);
  // Section 19 — public read-only branding / featured content
  app.use('/api/public', publicGeneralRoutes);
  app.use('/api/games', liveCasinoRoutes);
  // Section 15 — external provider webhooks. Mounted at the app root since
  // some providers don't allow /api/ paths in their callback configuration.
  app.use('/hooks', externalGamesWebhookRoutes);
  // Section 15 — outbound iframe public endpoint for white-label clients.
  app.use('/', embedRoutes);
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
