import { Router } from 'express';
import * as controller from './auth.controller';
import { requireTenant } from '../../middleware/tenant-context';
import { authenticateToken } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/require-role';
import * as swagger from '../../swagger/registry';
import {
  authRateLimiter,
  loginRateLimiter,
  passwordResetRateLimiter,
  refreshRateLimiter,
} from '../../middleware/rate-limiters';

const router = Router();

swagger.registerPath({
  method: 'post',
  path: '/api/auth/login',
  summary: 'User/Admin login',
  tags: ['Auth'],
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['password'],
          properties: {
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            username: { type: 'string' },
            branch_id: { type: 'string' },
            password: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Login successful' },
    '401': { description: 'Invalid credentials' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/auth/admin/login',
  summary: 'Admin panel login (superadmin/admin/agent/branch only)',
  tags: ['Auth'],
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['password'],
          properties: {
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            username: { type: 'string' },
            password: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Login successful' },
    '401': { description: 'Invalid credentials' },
    '403': { description: 'Account role is not allowed in the admin panel' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/auth/refresh',
  summary: 'Refresh access token',
  tags: ['Auth'],
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['refresh_token'],
          properties: {
            refresh_token: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Token refreshed' },
    '401': { description: 'Invalid refresh token' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/auth/logout',
  summary: 'Logout session',
  tags: ['Auth'],
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['refresh_token'],
          properties: {
            refresh_token: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Logged out' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/auth/forgot-password',
  summary: 'Request password reset',
  tags: ['Auth'],
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
          },
          anyOf: [{ required: ['email'] }, { required: ['phone'] }],
        },
      },
    },
  },
  responses: {
    '200': { description: 'Reset flow initiated (always generic response)' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/auth/reset-password',
  summary: 'Reset password with token',
  tags: ['Auth'],
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['token', 'new_password'],
          properties: {
            token: { type: 'string' },
            new_password: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Password reset successful' },
    '400': { description: 'Invalid token or payload' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/auth/register',
  summary: 'Register account',
  tags: ['Auth'],
  security: [],
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
            password: { type: 'string' },
            referral_code: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '201': { description: 'Registered' },
    '400': { description: 'Validation / duplicate error' },
  },
});

// Spec: auth endpoints capped at 5/min per IP. Login itself stays
// additionally throttled by `loginRateLimiter` (5 / 15min) so even when
// the per-minute budget is unused, a slow brute-force is still caught.
router.use(authRateLimiter);

router.post('/register', requireTenant(), controller.register);
router.post('/login', requireTenant(), loginRateLimiter, controller.login);
router.post(
  '/admin/login',
  requireTenant(),
  loginRateLimiter,
  controller.adminLogin
);
// Section 16 — Cashier panel.
swagger.registerPath({
  method: 'post',
  path: '/api/auth/cashier/login',
  summary: 'Cashier panel login (cashier/sales only, with branch lookup)',
  tags: ['Auth'],
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['password'],
          properties: {
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            username: { type: 'string' },
            branch_id: { type: 'string' },
            password: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Login successful + branch info' },
    '401': { description: 'Invalid credentials' },
    '403': { description: 'Account role is not allowed in the cashier panel' },
  },
});
swagger.registerPath({
  method: 'patch',
  path: '/api/auth/cashier/password',
  summary: 'Cashier self-service password change',
  tags: ['Auth'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Password updated; all sessions invalidated' },
    '401': { description: 'Current password is incorrect' },
  },
});
router.post(
  '/cashier/login',
  requireTenant(),
  loginRateLimiter,
  controller.cashierLogin
);
router.patch(
  '/cashier/password',
  authenticateToken(),
  requireRole('cashier', 'sales'),
  controller.cashierPasswordChange
);
router.post('/refresh', refreshRateLimiter, controller.refresh);
router.post('/logout', controller.logout);
router.post(
  '/forgot-password',
  requireTenant(),
  passwordResetRateLimiter,
  controller.forgotPassword
);
router.post(
  '/reset-password',
  requireTenant(),
  passwordResetRateLimiter,
  controller.resetPassword
);

export default router;
