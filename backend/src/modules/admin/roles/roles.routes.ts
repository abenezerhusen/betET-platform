import { Router, type Request, type Response, type NextFunction } from 'express';
import * as service from './roles.service';
import * as swagger from '../../../swagger/registry';
import {
  createRoleSchema,
  listRolesSchema,
  updateRoleSchema,
  updateRolePermissionsSchema,
} from './roles.dto';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/admin/roles',
  summary: 'List roles',
  tags: ['Admin Roles'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Roles list' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/roles',
  summary: 'Create role',
  tags: ['Admin Roles'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '201': { description: 'Role created' } },
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = listRolesSchema.parse(req.query);
    const out = await service.listRoles(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await service.getRole(req, req.params.id);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createRoleSchema.parse(req.body);
    const out = await service.createRole(req, body);
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateRoleSchema.parse(req.body);
    const out = await service.updateRole(req, req.params.id, body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

swagger.registerPath({
  method: 'put',
  path: '/api/admin/roles/{id}/permissions',
  summary: 'Section 22 — replace a role\'s permission list',
  tags: ['Admin Roles'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            permissions: { type: 'array', items: { type: 'string' } },
          },
          required: ['permissions'],
        },
      },
    },
  },
  responses: { '200': { description: 'Role permissions updated' } },
});

/**
 * Section 22 — `PUT /api/admin/roles/:id/permissions`.
 * Focused alias for `PUT /api/admin/roles/:id` that only mutates the
 * `permissions` array. The admin panel "Role Settings" modal calls
 * this endpoint when the Super Admin saves a permission selection.
 */
router.put(
  '/:id/permissions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateRolePermissionsSchema.parse(req.body);
      const out = await service.updateRole(req, req.params.id, {
        permissions: body.permissions,
      });
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await service.deleteRole(req, req.params.id);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
