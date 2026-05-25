import { Router, type Request, type Response, type NextFunction } from 'express';
import { mobileConfigQuerySchema } from './mobile.dto';
import { getMobileConfig } from './config.service';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/mobile/config',
  summary: 'Get mobile public configuration',
  tags: ['Mobile'],
  security: [],
  responses: {
    '200': { description: 'Mobile app configuration' },
  },
});

// No authentication required: the mobile app fetches this on first launch
// to know branding + min_app_version. Tenant context comes from
// x-tenant-id header / subdomain (resolved by setTenantContextMiddleware).
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = mobileConfigQuerySchema.parse(req.query);
    const out = await getMobileConfig(req, res, query);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
