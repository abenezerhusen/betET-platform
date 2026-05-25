import { Router, type Request, type Response, type NextFunction } from 'express';
import { adminReportsRateLimiter } from '../../../middleware/rate-limiters';
import * as swagger from '../../../swagger/registry';
import { dashboardStatsSchema } from './dashboard.dto';
import * as service from './dashboard.service';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/admin/dashboard/stats',
  summary: 'Unified dashboard stats (Section 2)',
  tags: ['Admin Dashboard'],
  security: [{ bearerAuth: [] }],
  parameters: [
    {
      name: 'tab',
      in: 'query',
      required: false,
      schema: {
        type: 'string',
        enum: ['summary', 'offline', 'online', 'detailed'],
        default: 'summary',
      },
    },
    {
      name: 'from',
      in: 'query',
      required: false,
      schema: { type: 'string', format: 'date-time' },
    },
    {
      name: 'to',
      in: 'query',
      required: false,
      schema: { type: 'string', format: 'date-time' },
    },
    {
      name: 'tenant_id',
      in: 'query',
      required: false,
      schema: { type: 'string', format: 'uuid' },
    },
  ],
  responses: { '200': { description: 'Dashboard stats payload' } },
});

router.use(adminReportsRateLimiter);

router.get('/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = dashboardStatsSchema.parse(req.query);
    const out = await service.dashboardStats(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
