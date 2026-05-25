import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { claimBonusSchema, listBonusesQuerySchema } from './user.dto';
import { claimBonus, listBonuses } from './bonuses.service';
import * as swagger from '../../swagger/registry';

const router = Router();

const idParamSchema = z.object({ id: z.string().uuid() });

swagger.registerPath({
  method: 'get',
  path: '/api/user/bonuses',
  summary: 'List my bonuses',
  tags: ['User Bonuses'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Bonus list' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/user/bonuses/{id}/claim',
  summary: 'Claim bonus',
  tags: ['User Bonuses'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: false,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '201': { description: 'Bonus claimed' } },
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listBonusesQuerySchema.parse(req.query);
    const out = await listBonuses(req, query);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/claim',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const body = claimBonusSchema.parse(req.body ?? {});
      const out = await claimBonus(req, id, body);
      res.status(201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
