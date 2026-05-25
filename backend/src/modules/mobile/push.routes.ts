import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticateToken } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/require-role';
import { sendPushSchema } from './mobile.dto';
import { sendPush } from './push.service';
import * as swagger from '../../swagger/registry';

const router = Router();

router.use(authenticateToken());
router.use(requireRole('superadmin', 'tenant_admin'));

swagger.registerPath({
  method: 'post',
  path: '/api/mobile/push/send',
  summary: 'Send push notification',
  tags: ['Mobile'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['title', 'body'],
          properties: {
            title: { type: 'string' },
            body: { type: 'string' },
            user_ids: { type: 'array', items: { type: 'string', format: 'uuid' } },
            topic: { type: 'string' },
            data: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Push queued/sent' },
  },
});

router.post(
  '/send',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = sendPushSchema.parse(req.body);
      const out = await sendPush(req, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
