import { Router, type Request, type Response, type NextFunction } from 'express';
import { closeShiftSchema, openShiftSchema } from './cashier.dto';
import { closeShift, currentShift, openShift } from './shifts.service';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/cashier/shift/current',
  summary: 'Current cashier shift',
  tags: ['Cashier'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Current shift details' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/shift/open',
  summary: 'Open cashier shift',
  tags: ['Cashier'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            opening_balance: { oneOf: [{ type: 'number' }, { type: 'string' }] },
            note: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '201': { description: 'Shift opened' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/cashier/shift/close',
  summary: 'Close cashier shift',
  tags: ['Cashier'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            closing_balance: { oneOf: [{ type: 'number' }, { type: 'string' }] },
            note: { type: 'string' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Shift closed' },
  },
});

router.get('/current', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await currentShift(req);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post('/open', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = openShiftSchema.parse(req.body);
    const out = await openShift(req, body);
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

router.post('/close', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = closeShiftSchema.parse(req.body);
    const out = await closeShift(req, body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
