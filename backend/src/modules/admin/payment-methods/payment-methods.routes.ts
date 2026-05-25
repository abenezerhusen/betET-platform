import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import {
  createPaymentMethodSchema,
  idParamSchema,
  listPaymentMethodsQuerySchema,
  seedDefaultsSchema,
  testPaymentMethodSchema,
  updatePaymentMethodSchema,
} from './payment-methods.dto';
import * as service from './payment-methods.service';
import * as swagger from '../../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/admin/payment-methods',
  summary: 'List payment methods',
  tags: ['Admin Payment Methods'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Payment methods list' } },
});

swagger.registerPath({
  method: 'put',
  path: '/api/admin/payment-methods/{id}',
  summary: 'Update payment method',
  tags: ['Admin Payment Methods'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '200': { description: 'Payment method updated' } },
});

router.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listPaymentMethodsQuerySchema.parse(req.query);
      res.json(await service.listPaymentMethods(req, query));
    } catch (err) {
      next(err);
    }
  }
);

/**
 * Surfaces the in-process providerRegistry — the source of truth for
 * which provider slugs are actually wired in code. Used by the admin
 * UI to populate provider-slug dropdowns.
 */
router.get(
  '/providers',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await service.listProviders(req));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      res.json(await service.getPaymentMethod(req, id));
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const body = updatePaymentMethodSchema.parse(req.body);
      res.json(await service.updatePaymentMethod(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

/* PATCH is an alias for PUT so the admin UI can submit partial flag
 * toggles (enable_deposit, is_default, etc.) without sending the full
 * row. Both verbs go through the same DTO + service. */
router.patch(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const body = updatePaymentMethodSchema.parse(req.body);
      res.json(await service.updatePaymentMethod(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

/* -------------------------------------------------------------------------- */
/* Section 21 — create / delete / test                                         */
/* -------------------------------------------------------------------------- */

swagger.registerPath({
  method: 'post',
  path: '/api/admin/payment-methods',
  summary: 'Create a new payment method (Section 21 Tab 3)',
  tags: ['Admin Payment Methods'],
  security: [{ bearerAuth: [] }],
  responses: { '201': { description: 'Payment method created' } },
});

router.post(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createPaymentMethodSchema.parse(req.body);
      res.status(201).json(await service.createPaymentMethod(req, body));
    } catch (err) {
      next(err);
    }
  }
);

swagger.registerPath({
  method: 'delete',
  path: '/api/admin/payment-methods/{id}',
  summary: 'Delete a payment method',
  tags: ['Admin Payment Methods'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Deleted' } },
});

router.delete(
  '/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      res.json(await service.deletePaymentMethod(req, id));
    } catch (err) {
      next(err);
    }
  }
);

swagger.registerPath({
  method: 'post',
  path: '/api/admin/payment-methods/{id}/test',
  summary: 'Test the configured connection for a payment method',
  tags: ['Admin Payment Methods'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Test result with per-check breakdown' } },
});

router.post(
  '/:id/test',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = idParamSchema.parse(req.params);
      const body = testPaymentMethodSchema.parse(req.body);
      res.json(await service.testPaymentMethod(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/seed-defaults',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = seedDefaultsSchema.parse(req.body);
      res.json(await service.seedDefaults(req, body));
    } catch (err) {
      next(err);
    }
  }
);

export default router;
