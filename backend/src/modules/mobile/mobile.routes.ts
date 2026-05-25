import { Router } from 'express';
import devicesRouter from './devices.routes';
import pushRouter from './push.routes';
import configRouter from './config.routes';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/mobile/config',
  summary: 'Mobile configuration endpoint',
  tags: ['Mobile'],
  security: [],
  responses: { '200': { description: 'Tenant-scoped mobile config' } },
});

// Public-ish (tenant-only): the mobile app reads branding before login.
router.use('/config', configRouter);

// Authenticated user can register / list / revoke their own devices.
router.use('/', devicesRouter);

// Admin-only push surface. Mounted at /api/mobile/push so the spec'd
// /api/mobile/push/send maps correctly.
router.use('/push', pushRouter);

export default router;
