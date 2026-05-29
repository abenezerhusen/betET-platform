import { Router, type Request, type Response, type NextFunction } from 'express';
import * as service from './users.service';
import {
  assignRoleSchema,
  changeUserPasswordSchema,
  createUserSchema,
  kycRejectSchema,
  listUsersSchema,
  suspendUserSchema,
  updatePermissionsSchema,
  updateUserSchema,
  userActivitySchema,
  userStatusSchema,
} from './users.dto';
import * as swagger from '../../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/admin/users',
  summary: 'List users',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Users list' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/users',
  summary: 'Create user',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['full_name', 'password'],
          properties: {
            full_name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            role: { type: 'string' },
            password: { type: 'string' },
            status: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  },
  responses: {
    '201': { description: 'User created' },
    '400': { description: 'Validation / business error' },
  },
});

swagger.registerPath({
  method: 'put',
  path: '/api/admin/users/{id}',
  summary: 'Update user',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            role: { type: 'string' },
            status: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'User updated' },
    '404': { description: 'User not found' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/users/{id}/suspend',
  summary: 'Suspend user',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'User suspended' },
  },
});

swagger.registerPath({
  method: 'patch',
  path: '/api/admin/users/{id}/status',
  summary: 'Toggle user status (active / suspended / disabled / banned)',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['status'],
          properties: {
            status: {
              type: 'string',
              enum: ['active', 'suspended', 'disabled', 'banned'],
            },
            reason: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'User status updated' },
    '400': { description: 'Cannot change own status' },
  },
});

swagger.registerPath({
  method: 'patch',
  path: '/api/admin/users/{id}/password',
  summary: 'Admin change user password',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['password'],
          properties: {
            password: { type: 'string', minLength: 8 },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Password updated; sessions invalidated' },
  },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/users/{id}',
  summary: 'Get user by id',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'User details' },
    '404': { description: 'Not found' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/users/{id}/assign-role',
  summary: 'Assign role to user',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['role_id'],
          properties: {
            role_id: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Role assigned' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/users/{id}/kyc-approve',
  summary: 'Approve KYC',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'KYC approved' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/users/{id}/kyc-reject',
  summary: 'Reject KYC',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            reason: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'KYC rejected' },
  },
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = listUsersSchema.parse(req.query);
    const out = await service.listUsers(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await service.getUser(req, req.params.id);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createUserSchema.parse(req.body);
    const out = await service.createUser(req, body);
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateUserSchema.parse(req.body);
    const out = await service.updateUser(req, req.params.id, body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/suspend',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = suspendUserSchema.parse(req.body);
      const out = await service.suspendUser(req, req.params.id, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id/status',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = userStatusSchema.parse(req.body);
      const out = await service.setUserStatus(req, req.params.id, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id/password',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = changeUserPasswordSchema.parse(req.body);
      const out = await service.changeUserPassword(req, req.params.id, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/kyc-approve',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await service.kycApprove(req, req.params.id);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/kyc-reject',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = kycRejectSchema.parse(req.body);
      const out = await service.kycReject(req, req.params.id, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id/activity',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = userActivitySchema.parse(req.query);
      const out = await service.userActivity(req, req.params.id, params);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/assign-role',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = assignRoleSchema.parse(req.body);
      const out = await service.assignRole(req, req.params.id, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* Section 23 — Role Settings Modal: per-user permission override     */
/* ------------------------------------------------------------------ */

swagger.registerPath({
  method: 'put',
  path: '/api/admin/users/{id}/permissions',
  summary: 'Replace a user\u2019s per-user permission override list',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['permissions'],
          properties: {
            permissions: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Permissions updated; reflected in JWT on next login' },
  },
});

router.put(
  '/:id/permissions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updatePermissionsSchema.parse(req.body);
      const out = await service.updatePermissions(req, req.params.id, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* Section 23 — UserDetailsModal: aggregated profile + recent items    */
/* ------------------------------------------------------------------ */

swagger.registerPath({
  method: 'get',
  path: '/api/admin/users/{id}/details',
  summary: 'Aggregated user profile + recent bets / deposits / withdrawals',
  tags: ['Admin Users'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Profile + aggregates + recent activity' },
    '404': { description: 'User not found' },
  },
});

router.get(
  '/:id/details',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await service.getUserDetails(req, req.params.id);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
