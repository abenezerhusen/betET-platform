import { Router } from 'express';
import sessionRouter from './session.routes';
import webhookRouter from './webhook.routes';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'post',
  path: '/api/game/session/create',
  summary: 'Create game session',
  tags: ['Game Session'],
  security: [{ bearerAuth: [] }],
  responses: { '201': { description: 'Session created' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/game/webhook/debit',
  summary: 'Provider debit webhook',
  tags: ['Game Webhooks'],
  security: [],
  responses: { '200': { description: 'Accepted' } },
});

// Outbound: player creates a game session and gets a launch URL.
// Authenticated as a player; nested router applies the auth middleware.
router.use('/session', sessionRouter);

// Inbound: provider-to-platform webhooks. Authenticated by HMAC + IP
// allowlist. Standard Bearer auth is intentionally NOT applied here.
router.use('/webhook', webhookRouter);

export default router;
