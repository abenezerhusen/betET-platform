import { Router, type Request, type Response, type NextFunction } from 'express';
import { authenticateToken } from '../../middleware/authenticate';
import * as swagger from '../../swagger/registry';
import {
  deviceIdParamSchema,
  registerDeviceSchema,
} from './mobile.dto';
import {
  listMyDevices,
  registerDevice,
  unregisterDevice,
} from './devices.service';

const router = Router();

router.use(authenticateToken());

swagger.registerPath({
  method: 'post',
  path: '/api/mobile/register-device',
  summary: 'Register mobile push device',
  tags: ['Mobile'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['device_id', 'platform', 'push_token'],
          properties: {
            device_id: { type: 'string' },
            platform: { type: 'string', enum: ['android', 'ios', 'web'] },
            push_token: { type: 'string' },
            app_version: { type: 'string' },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  },
  responses: {
    '201': { description: 'Device created' },
    '200': { description: 'Device updated/idempotent' },
  },
});

swagger.registerPath({
  method: 'get',
  path: '/api/mobile/devices',
  summary: 'List my mobile devices',
  tags: ['Mobile'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Device list' },
  },
});

swagger.registerPath({
  method: 'delete',
  path: '/api/mobile/devices/{id}',
  summary: 'Unregister mobile device',
  tags: ['Mobile'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Device unregistered' },
  },
});

router.post(
  '/register-device',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = registerDeviceSchema.parse(req.body);
      const out = await registerDevice(req, body);
      res.status(out.created ? 201 : 200).json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/devices',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const out = await listMyDevices(req);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/devices/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = deviceIdParamSchema.parse(req.params);
      const out = await unregisterDevice(req, id);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
