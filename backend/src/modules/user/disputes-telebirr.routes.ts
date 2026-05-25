import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import {
  disputeIdParamSchema,
  listMyDisputesQuerySchema,
  submitDisputeSchema,
} from './disputes-telebirr.dto';
import * as service from './disputes-telebirr.service';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'post',
  path: '/api/user/disputes/telebirr',
  summary: 'Submit Telebirr dispute',
  tags: ['User Payments'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '201': { description: 'Dispute submitted' } },
});

router.post(
  '/disputes/telebirr',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = submitDisputeSchema.parse(req.body);
      res.status(201).json(await service.submitDispute(req, body));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/disputes/telebirr',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listMyDisputesQuerySchema.parse(req.query);
      res.json(await service.listMyDisputes(req, query));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/disputes/telebirr/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = disputeIdParamSchema.parse(req.params);
      res.json(await service.getMyDispute(req, id));
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/disputes/telebirr/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = disputeIdParamSchema.parse(req.params);
      res.json(await service.cancelMyDispute(req, id));
    } catch (err) {
      next(err);
    }
  }
);

export default router;
