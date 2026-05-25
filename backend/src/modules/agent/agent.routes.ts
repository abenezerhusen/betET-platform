import { Router } from 'express';

import * as controller from './agent.controller';
import { authenticateAgent } from './agent.middleware';
import {
  agentGeneralRateLimiter,
  agentLoginRateLimiter,
} from './agent.rate-limiters';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'post',
  path: '/api/agent/auth/login',
  summary: 'Agent login',
  tags: ['Agent'],
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['telebirrNumber', 'password', 'deviceId'],
          properties: {
            telebirrNumber: { type: 'string' },
            password: { type: 'string' },
            deviceId: { type: 'string' },
            deviceName: { type: 'string' },
            appVersion: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Agent authenticated' },
    '401': { description: 'Invalid credentials' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/agent/auth/refresh',
  summary: 'Agent token refresh',
  tags: ['Agent'],
  security: [],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Refreshed token' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/agent/sms/report',
  summary: 'Report single SMS',
  tags: ['Agent'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['smsBody'],
          properties: {
            smsBody: { type: 'string' },
            senderNumber: { type: 'string' },
            receivedAt: { type: 'string', format: 'date-time' },
            deviceTimestamp: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'SMS accepted' },
  },
});

swagger.registerPath({
  method: 'get',
  path: '/api/agent/transactions',
  summary: 'List agent transactions',
  tags: ['Agent'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Paged transactions list' },
  },
});

/**
 * The 200/min agent limiter applies to every authenticated route. Login
 * has its own (10/hr/device) limiter on top. Refresh is treated like
 * any other agent request — once authenticated, fairness comes from the
 * 200/min cap.
 */

/* ------------------------------------------------------------------------- */
/* Auth                                                                      */
/* ------------------------------------------------------------------------- */

router.post('/auth/login', agentLoginRateLimiter, controller.login);

router.post(
  '/auth/refresh',
  // Refresh validates the existing token internally; per-device rate
  // limiting is enough to deter token-hopping abuse.
  agentLoginRateLimiter,
  controller.refresh
);

router.post(
  '/auth/heartbeat',
  authenticateAgent(),
  agentGeneralRateLimiter,
  controller.heartbeat
);

router.post(
  '/heartbeat',
  authenticateAgent(),
  agentGeneralRateLimiter,
  controller.heartbeatCompat
);

/* ------------------------------------------------------------------------- */
/* SMS reporting                                                             */
/* ------------------------------------------------------------------------- */

router.post(
  '/sms/report',
  authenticateAgent(),
  agentGeneralRateLimiter,
  controller.reportSms
);

router.post(
  '/sms/batch',
  authenticateAgent(),
  agentGeneralRateLimiter,
  controller.reportSmsBatch
);

router.patch(
  '/commands/:id',
  authenticateAgent(),
  agentGeneralRateLimiter,
  controller.updateCommandResult
);

/* ------------------------------------------------------------------------- */
/* Status & manual confirm                                                   */
/* ------------------------------------------------------------------------- */

router.get(
  '/status',
  authenticateAgent(),
  agentGeneralRateLimiter,
  controller.status
);

router.get(
  '/transactions',
  authenticateAgent(),
  agentGeneralRateLimiter,
  controller.listTransactions
);

router.post(
  '/transaction/:telebirrRef/confirm',
  authenticateAgent(),
  agentGeneralRateLimiter,
  controller.confirmTransaction
);

export default router;
