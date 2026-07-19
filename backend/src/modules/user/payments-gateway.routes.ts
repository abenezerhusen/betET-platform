import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import * as swagger from '../../swagger/registry';
import * as gatewayService from '../payments/gateway/gateway.service';
import { getIp, getUa, getUserScope } from './user-shared';
import {
  gatewayConfigQuerySchema,
  gatewayHistoryQuerySchema,
  gatewayInitiateSchema,
} from './payments-gateway.dto';

/**
 * User-facing "Online Payment" gateway endpoints. Independent of the
 * Telebirr P2P and branch-withdrawal routes; mounted alongside them.
 *
 *   GET    /api/user/payments/gateway/config
 *   POST   /api/user/payments/gateway/deposit
 *   POST   /api/user/payments/gateway/withdrawal
 *   GET    /api/user/payments/gateway/history
 *   GET    /api/user/payments/gateway/:id
 *   DELETE /api/user/payments/gateway/:id/cancel
 */
const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/user/payments/gateway/config',
  summary: 'List enabled online-payment gateway methods for the user',
  tags: ['User Payments'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Enabled methods + phone-edit flag' } },
});

router.get(
  '/payments/gateway/config',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const query = gatewayConfigQuerySchema.parse(req.query);
      const out = await gatewayService.getGatewayConfig({
        tenantId: scope.tenantId,
        userId: scope.userId,
        channel: query.channel ?? null,
      });
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/payments/gateway/deposit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const body = gatewayInitiateSchema.parse(req.body);
      const out = await gatewayService.initiateGatewayDeposit({
        tenantId: scope.tenantId,
        userId: scope.userId,
        providerSlug: body.provider_slug,
        amount: body.amount,
        requestedPhone: body.phone ?? null,
        ip: getIp(req),
        userAgent: getUa(req),
      });
      res.status(201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/payments/gateway/withdrawal',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const body = gatewayInitiateSchema.parse(req.body);
      const out = await gatewayService.initiateGatewayWithdrawal({
        tenantId: scope.tenantId,
        userId: scope.userId,
        providerSlug: body.provider_slug,
        amount: body.amount,
        requestedPhone: body.phone ?? null,
        ip: getIp(req),
        userAgent: getUa(req),
      });
      res.status(201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/payments/gateway/history',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const query = gatewayHistoryQuerySchema.parse(req.query);
      const out = await gatewayService.listGatewayRequests({
        tenantId: scope.tenantId,
        userId: scope.userId,
        direction: query.direction ?? null,
        page: query.page,
        limit: query.limit,
      });
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/payments/gateway/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const out = await gatewayService.getGatewayRequest({
        tenantId: scope.tenantId,
        userId: scope.userId,
        id: String(req.params.id),
      });
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/payments/gateway/:id/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getUserScope(req);
      const out = await gatewayService.cancelGatewayRequest({
        tenantId: scope.tenantId,
        userId: scope.userId,
        id: String(req.params.id),
        ip: getIp(req),
        userAgent: getUa(req),
      });
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
