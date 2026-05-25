import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticateToken } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/require-role';
import { createSessionSchema, sessionIdParamSchema } from './game.dto';
import { createSession, endSession } from './session.service';
import * as swagger from '../../swagger/registry';

const router = Router();

router.use(authenticateToken());
router.use(requireRole('user', 'affiliate'));

swagger.registerPath({
  method: 'post',
  path: '/api/game/session/create',
  summary: 'Create game session',
  tags: ['Game Session'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '201': { description: 'Session created' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/game/session/{id}/end',
  summary: 'End game session',
  tags: ['Game Session'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Session ended' } },
});

router.post(
  '/create',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createSessionSchema.parse(req.body);
      const out = await createSession(req, body);
      res.status(201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/end',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = sessionIdParamSchema.parse(req.params);
      const out = await endSession(req, id);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
