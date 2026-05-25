import { Router } from 'express';
import { authenticateToken } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/require-role';
import tenantsRouter from './tenants/tenants.routes';
import usersRouter from './users/users.routes';
import rolesRouter from './roles/roles.routes';
import walletsRouter from './wallets/wallets.routes';
import gamesRouter from './games/games.routes';
import settingsRouter from './settings/settings.routes';
import reportsRouter from './reports/reports.routes';
import dashboardRouter from './dashboard/dashboard.routes';
import auditLogsRouter from './audit-logs/audit-logs.routes';
import bonusesRouter from './bonuses/bonuses.routes';
import telebirrRouter from './telebirr/admin.telebirr.routes';
import paymentMethodsRouter from './payment-methods/payment-methods.routes';

// New admin-panel coverage modules (P2P, tournaments, sportsbook, casino,
// promotions, monitoring, panel-specific reports, settings extras,
// admin transactions explorer).
import p2pRouter from './p2p/p2p.routes';
import tournamentsRouter from './tournaments/tournaments.module';
import sportsbookRouter from './sportsbook/sportsbook.module';
import casinoRouter from './casino/casino.module';
import promotionsRouter from './promotions/promotions.module';
import rafflesAliasRouter from './promotions/raffles.routes';
import affiliatesAliasRouter from './promotions/affiliates.routes';
import monitoringRouter from './monitoring/monitoring.module';
import reportsPanelRouter from './reports-panel/reports-panel.module';
import settingsExtraRouter from './settings-extra/settings-extra.module';
import adminTransactionsRouter from './transactions/transactions.module';
import streaksRouter from './streaks/streaks.module';
import opsRouter from './ops/ops.module';
import packagesRouter from './packages/packages.module';
import gamePicksRouter from './game-picks/game-picks.module';
import iframeRouter from './iframe/iframe.routes';
import integrationsAliasRouter from './integrations/integrations.routes';
import betsRouter from './bets/bets.module';
import jackpotsRouter from './jackpots/jackpots.module';
import betForMeRouter from './bet-for-me/bet-for-me.module';
// Section 18 — match-lifecycle endpoints (odds + result + status)
import matchesRouter from './matches/matches.module';

// Section 10 — Monitoring (spec-aligned route aliases)
import logsRouter from './logs/logs.module';
import analyticsRouter from './analytics/analytics.module';
import notificationsAliasRouter from './notifications-alias/notifications-alias.module';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/admin',
  summary: 'Admin API root',
  tags: ['Admin'],
  security: [{ bearerAuth: [] }],
  responses: { '404': { description: 'Mountpoint only (no direct handler)' } },
});

// All admin routes require an authenticated superadmin or tenant_admin.
router.use(authenticateToken());
router.use(requireRole('superadmin', 'tenant_admin'));

// /api/admin/dashboard — unified Section-2 KPIs (read-only)
router.use('/dashboard', dashboardRouter);

// /api/admin/tenants — superadmin only (enforced inside the sub-router as well).
router.use('/tenants', tenantsRouter);
router.use('/users', usersRouter);
router.use('/roles', rolesRouter);
router.use('/wallets', walletsRouter);
router.use('/games', gamesRouter);
router.use('/settings', settingsRouter);
router.use('/reports', reportsRouter);
router.use('/audit-logs', auditLogsRouter);
router.use('/bonuses', bonusesRouter);
router.use('/telebirr', telebirrRouter);
router.use('/payment-methods', paymentMethodsRouter);

// New admin-panel coverage routers.
router.use('/p2p', p2pRouter);
router.use('/tournaments', tournamentsRouter);
router.use('/sportsbook', sportsbookRouter);
router.use('/casino', casinoRouter);
router.use('/promotions', promotionsRouter);
// Spec-aligned aliases — promotions sub-resources also live at the
// top-level admin path for newer clients ( /api/admin/raffles, etc.).
router.use('/raffles', rafflesAliasRouter);
router.use('/affiliates', affiliatesAliasRouter);
router.use('/monitoring', monitoringRouter);

// Section 10 — spec-aligned aliases. Legacy /monitoring/* mounts continue
// to serve existing UI traffic; the new top-level paths match the guide:
//   /api/admin/logs/{activity,errors,audit}
//   /api/admin/analytics/performance
//   /api/admin/notifications (+ /:id/read)
router.use('/logs', logsRouter);
router.use('/analytics', analyticsRouter);
router.use('/notifications', notificationsAliasRouter);
router.use('/panel-reports', reportsPanelRouter);
router.use('/configurations', settingsExtraRouter);
router.use('/transactions', adminTransactionsRouter);
router.use('/streaks', streaksRouter);
router.use('/packages', packagesRouter);
router.use('/game-picks', gamePicksRouter);

// Section 14 — spec-aligned aliases. The legacy mountpoints under
// /api/admin/configurations/{iframes,integrations}/* are still wired through
// settingsExtraRouter for backwards-compat.
router.use('/iframe', iframeRouter);
router.use('/integrations', integrationsAliasRouter);

// Section 4 — Bets
router.use('/bets', betsRouter);
router.use('/jackpots', jackpotsRouter);
router.use('/bet-for-me', betForMeRouter);

// Section 18 — admin matches lifecycle (PATCH /odds, POST /result, /status)
router.use('/matches', matchesRouter);

router.use('/', opsRouter);

export default router;
