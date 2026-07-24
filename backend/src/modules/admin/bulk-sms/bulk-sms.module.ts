/**
 * Admin Bulk SMS Marketing module — isolated phone-gateway (TextBee) campaigns.
 *
 * Mounted at /api/admin/bulk-sms and gated by the `marketing.bulk_sms`
 * permission (Super Admin holds the wildcard by default; a Super Admin can
 * grant this single permission to an Administrator role from Role Settings).
 *
 * Endpoints:
 *   GET    /gateway-settings        → current gateway config (key masked)
 *   PUT    /gateway-settings        → save config (API key sealed at rest)
 *   POST   /gateway-settings/test   → test connection (no SMS sent)
 *   POST   /gateway-settings/test-sms → send a single test SMS
 *   GET    /templates               → list templates
 *   POST   /templates               → create template
 *   PUT    /templates/:id           → update template
 *   DELETE /templates/:id           → delete template
 *   POST   /campaigns               → create campaign (queues recipients)
 *   GET    /campaigns               → list campaigns
 *   GET    /campaigns/:id           → campaign detail + progress
 *   POST   /campaigns/:id/cancel    → cancel a queued/sending campaign
 *   GET    /queue                   → per-recipient send queue
 *   GET    /logs                    → delivery history (SMS History)
 *   GET    /reports                 → aggregate reporting numbers
 *
 * This module NEVER touches the OTP SMS/Telegram settings, templates or
 * notification tables — it is a standalone marketing pipeline.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { requirePermission } from '../../../middleware/require-permission';
import * as service from './bulk-sms.service';
import {
  gatewaySettingsSchema,
  testSmsSchema,
  templateCreateSchema,
  templateUpdateSchema,
  campaignCreateSchema,
  listQuerySchema,
  idParamSchema,
} from './bulk-sms.dto';

const wrap =
  <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const wrapStatus =
  <T>(status: number, fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const router = Router();

// Every route in this module requires the Bulk SMS marketing permission.
router.use(requirePermission('marketing.bulk_sms'));

/* Gateway settings ---------------------------------------------------------- */
router.get('/gateway-settings', wrap((req) => service.getGatewaySettings(req)));
router.put(
  '/gateway-settings',
  wrap((req) => service.saveGatewaySettings(req, gatewaySettingsSchema.parse(req.body)))
);
router.post(
  '/gateway-settings/test',
  wrap((req) => service.testConnection(req))
);
router.post(
  '/gateway-settings/test-sms',
  wrap((req) => service.sendTestSms(req, testSmsSchema.parse(req.body)))
);

/* Templates ----------------------------------------------------------------- */
router.get('/templates', wrap((req) => service.listTemplates(req, listQuerySchema.parse(req.query))));
router.post(
  '/templates',
  wrapStatus(201, (req) => service.createTemplate(req, templateCreateSchema.parse(req.body)))
);
router.put(
  '/templates/:id',
  wrap((req) =>
    service.updateTemplate(
      req,
      idParamSchema.parse(req.params).id,
      templateUpdateSchema.parse(req.body)
    )
  )
);
router.delete(
  '/templates/:id',
  wrap((req) => service.deleteTemplate(req, idParamSchema.parse(req.params).id))
);

/* Campaigns ----------------------------------------------------------------- */
router.post(
  '/campaigns',
  wrapStatus(201, (req) => service.createCampaign(req, campaignCreateSchema.parse(req.body)))
);
router.get('/campaigns', wrap((req) => service.listCampaigns(req, listQuerySchema.parse(req.query))));
router.get('/campaigns/:id', wrap((req) => service.getCampaign(req, idParamSchema.parse(req.params).id)));
router.post(
  '/campaigns/:id/cancel',
  wrap((req) => service.cancelCampaign(req, idParamSchema.parse(req.params).id))
);

/* Queue / logs / reports ---------------------------------------------------- */
router.get('/queue', wrap((req) => service.listQueue(req, listQuerySchema.parse(req.query))));
router.get('/logs', wrap((req) => service.listLogs(req, listQuerySchema.parse(req.query))));
router.get('/reports', wrap((req) => service.reports(req)));

export default router;
