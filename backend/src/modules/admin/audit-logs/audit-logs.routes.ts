import { Router, type Request, type Response, type NextFunction } from 'express';
import * as service from './audit-logs.service';
import { listAuditLogsSchema } from './audit-logs.dto';
import * as swagger from '../../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/admin/audit-logs',
  summary: 'Search audit logs',
  tags: ['Admin Audit Logs'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Audit log list' } },
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = listAuditLogsSchema.parse(req.query);
    const out = await service.searchAuditLogs(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
