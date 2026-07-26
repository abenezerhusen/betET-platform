/**
 * Admin routes for the sports data provider (Odds-API.io) integration.
 *
 * Mounted at /api/admin/sports-provider and gated by the
 * `settings.sports_provider` permission (Super Admin holds the wildcard).
 *
 * Endpoints (the minimal admin control surface required by the spec):
 *   GET  /            → status: mode, enabled, key source (masked), config,
 *                       last run / last success / last error, counts
 *   PUT  /            → save config (API key sealed at rest, never echoed)
 *   POST /test        → test the API connection (no data written)
 *   POST /sync        → run a manual sync now (prematch + live)
 *
 * It NEVER touches betting, wallet, payment or auth. In the default
 * DATA_PROVIDER=mock mode saving config is harmless — the sync stays dormant.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { requirePermission } from '../../../middleware/require-permission';
import * as service from './provider.service';
import { providerConfigSchema } from './provider.dto';

const wrap =
  <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const router = Router();

router.use(requirePermission('settings.sports_provider'));

router.get('/', wrap((req) => service.getStatus(req)));
router.put('/', wrap((req) => service.saveConfig(req, providerConfigSchema.parse(req.body))));
router.post('/test', wrap((req) => service.testConnection(req)));
router.post('/sync', wrap((req) => service.syncNow(req)));

export default router;
