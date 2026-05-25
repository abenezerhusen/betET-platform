import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireRole } from '../../../middleware/require-role';
import * as service from './tenants.service';
import * as swagger from '../../../swagger/registry';
import {
  createTenantSchema,
  listTenantsSchema,
  updateTenantSchema,
} from './tenants.dto';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/admin/tenants',
  summary: 'List tenants',
  tags: ['Admin Tenants'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Tenants list' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/tenants',
  summary: 'Create tenant',
  tags: ['Admin Tenants'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '201': { description: 'Tenant created' } },
});

// Tenant management is restricted to superadmin even within the admin scope.
router.use(requireRole('superadmin'));

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = listTenantsSchema.parse(req.query);
    const out = await service.listTenants(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await service.getTenant(req, req.params.id);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createTenantSchema.parse(req.body);
    const out = await service.createTenant(req, body);
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateTenantSchema.parse(req.body);
    const out = await service.updateTenant(req, req.params.id, body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await service.softDeleteTenant(req, req.params.id);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
