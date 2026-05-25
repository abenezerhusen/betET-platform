import { Router, type Request, type Response, type NextFunction } from 'express';
import { z, ZodError } from 'zod';
import { logger } from '../../infrastructure/logger';
import * as swagger from '../../swagger/registry';
import {
  balanceWebhookSchema,
  creditWebhookSchema,
  debitWebhookSchema,
  rollbackWebhookSchema,
} from './game.dto';
import {
  WebhookError,
  auditRejectedWebhook,
  handleBalance,
  handleCredit,
  handleDebit,
  handleRollback,
} from './webhook.service';

const router = Router();

swagger.registerPath({
  method: 'post',
  path: '/api/game/webhook/balance',
  summary: 'Game provider balance webhook',
  tags: ['Game Webhooks'],
  security: [],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '200': { description: 'Balance response' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/game/webhook/debit',
  summary: 'Game provider debit webhook',
  tags: ['Game Webhooks'],
  security: [],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '200': { description: 'Debit processed' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/game/webhook/credit',
  summary: 'Game provider credit webhook',
  tags: ['Game Webhooks'],
  security: [],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '200': { description: 'Credit processed' } },
});

/**
 * Webhook handlers do NOT use the standard Bearer auth middleware. They
 * are authenticated by HMAC + IP allowlist, both checked inside each
 * handler via authorizeWebhook(). All errors are translated into a
 * machine-readable JSON envelope so providers can handle them without
 * parsing free-form text.
 */
function makeHandler<S extends z.ZodTypeAny>(
  kind: 'balance' | 'debit' | 'credit' | 'rollback',
  schema: S,
  fn: (req: Request, body: z.infer<S>) => Promise<unknown>
) {
  type T = z.infer<S>;
  return async (req: Request, res: Response, _next: NextFunction) => {
    let parsed: T | null = null;
    try {
      parsed = schema.parse(req.body);
    } catch (err) {
      if (err instanceof ZodError) {
        // Best-effort audit even with no session; tenant resolution will
        // fail gracefully and log via bypassRls.
        const session_id =
          typeof (req.body as { session_id?: unknown })?.session_id === 'string'
            ? (req.body as { session_id: string }).session_id
            : undefined;
        const request_id =
          typeof (req.body as { request_id?: unknown })?.request_id === 'string'
            ? (req.body as { request_id: string }).request_id
            : undefined;
        await auditRejectedWebhook(
          req,
          kind,
          new WebhookError(400, 'invalid_body', 'request body validation failed', {
            issues: err.issues,
          }),
          { session_id, request_id }
        );
        return res.status(400).json({
          status: 'error',
          code: 'invalid_body',
          message: 'request body validation failed',
          issues: err.issues,
        });
      }
      logger.error({ err }, 'unexpected error in webhook body parse');
      return res.status(500).json({ status: 'error', code: 'internal_error' });
    }

    try {
      const out = await fn(req, parsed);
      return res.json(out);
    } catch (err) {
      if (err instanceof WebhookError) {
        await auditRejectedWebhook(req, kind, err, parsed as {
          session_id?: string;
          transaction_id?: string;
          request_id?: string;
        });
        return res.status(err.status).json({
          status: 'error',
          code: err.code,
          message: err.message,
          details: err.details ?? null,
        });
      }
      logger.error({ err, kind }, 'unhandled error in game webhook handler');
      return res
        .status(500)
        .json({ status: 'error', code: 'internal_error', message: 'unexpected error' });
    }
  };
}

router.post('/balance', makeHandler('balance', balanceWebhookSchema, handleBalance));
router.post('/debit', makeHandler('debit', debitWebhookSchema, handleDebit));
router.post('/credit', makeHandler('credit', creditWebhookSchema, handleCredit));
router.post('/rollback', makeHandler('rollback', rollbackWebhookSchema, handleRollback));

export default router;
