import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { adminReportsRateLimiter } from '../../../middleware/rate-limiters';
import * as service from './reports.service';
import * as swagger from '../../../swagger/registry';
import {
  betsReportSchema,
  offlineCashReportSchema,
  onlineCashReportSchema,
  payableActionSchema,
  payableReportSchema,
  revenueReportSchema,
  transactionsReportSchema,
  usersReportSchema,
} from './reports.dto';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/admin/reports/revenue',
  summary: 'Revenue report',
  tags: ['Admin Reports'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Revenue report payload' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/reports/bets',
  summary: 'Bets report',
  tags: ['Admin Reports'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Bets report payload' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/reports/users',
  summary: 'Users report',
  tags: ['Admin Reports'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Users report payload' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/reports/online-cash',
  summary: 'Online cash report',
  tags: ['Admin Reports'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Online cash report' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/reports/offline-cash',
  summary: 'Offline cash report',
  tags: ['Admin Reports'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Offline cash report' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/reports/payable',
  summary: 'Payable report',
  tags: ['Admin Reports'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Payable report (daily/agent/branch/sales)' } },
});

swagger.registerPath({
  method: 'patch',
  path: '/api/admin/reports/payable/{id}/approve',
  summary: 'Approve a payable row',
  tags: ['Admin Reports'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Updated row' } },
});

swagger.registerPath({
  method: 'patch',
  path: '/api/admin/reports/payable/{id}/reject',
  summary: 'Reject a payable row',
  tags: ['Admin Reports'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Updated row' } },
});

// Spec: admin reports capped at 30 requests/min/admin. Heavy queries are
// also memoized by `withCache` for 60s in reports.service so the limiter
// covers cache-warming bursts.
router.use(adminReportsRateLimiter);

router.get('/revenue', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = revenueReportSchema.parse(req.query);
    const out = await service.revenueReport(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/bets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = betsReportSchema.parse(req.query);
    const out = await service.betsReport(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/users', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = usersReportSchema.parse(req.query);
    const out = await service.usersReport(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get(
  '/transactions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = transactionsReportSchema.parse(req.query);
      const out = await service.transactionsReport(req, params);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* Section 6 — Cash & Payable                                          */
/* ------------------------------------------------------------------ */

router.get('/online-cash', async (req, res, next) => {
  try {
    const params = onlineCashReportSchema.parse(req.query);
    const out = await service.onlineCashReport(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/offline-cash', async (req, res, next) => {
  try {
    const params = offlineCashReportSchema.parse(req.query);
    const out = await service.offlineCashReport(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

const commissionUpdateSchema = z.object({
  agent: z.number().min(0).max(100).optional(),
  branch: z.number().min(0).max(100).optional(),
  sales: z.number().min(0).max(100).optional(),
});

router.get('/payable/commission-rates', async (req, res, next) => {
  try {
    const out = await service.getCommissionRates(req);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.put('/payable/commission-rates', async (req, res, next) => {
  try {
    const body = commissionUpdateSchema.parse(req.body ?? {});
    const out = await service.setCommissionRates(req, body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/payable', async (req, res, next) => {
  try {
    const params = payableReportSchema.parse(req.query);
    const out = await service.payableReport(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

const idParam = z.object({ id: z.string().uuid() });

router.patch('/payable/:id/approve', async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const body = payableActionSchema.parse(req.body ?? {});
    const out = await service.actOnPayable(req, id, 'approve', body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.patch('/payable/:id/reject', async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const body = payableActionSchema.parse(req.body ?? {});
    const out = await service.actOnPayable(req, id, 'reject', body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.patch('/payable/:id/mark-paid', async (req, res, next) => {
  try {
    const { id } = idParam.parse(req.params);
    const body = payableActionSchema.parse(req.body ?? {});
    const out = await service.actOnPayable(req, id, 'mark_paid', body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
