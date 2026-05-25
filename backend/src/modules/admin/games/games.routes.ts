import { Router, type Request, type Response, type NextFunction } from 'express';
import * as service from './games.service';
import {
  createGameSchema,
  listGameSessionsSchema,
  listGamesSchema,
  toggleGameSchema,
  updateGameSchema,
} from './games.dto';
import * as swagger from '../../../swagger/registry';
import rtpRouter from '../rtp/rtp.routes';

const router = Router();

// Section 15 — RTP Management for the 4 internal games.
// /api/admin/games/rtp        → list
// /api/admin/games/:id/rtp    → patch
// /api/admin/games/:id/status → patch
router.use(rtpRouter);

swagger.registerPath({
  method: 'get',
  path: '/api/admin/games',
  summary: 'List admin games',
  tags: ['Admin Games'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Games list' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/games',
  summary: 'Create game',
  tags: ['Admin Games'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          required: ['slug', 'name'],
          properties: {
            slug: { type: 'string' },
            name: { type: 'string' },
            provider: { type: 'string' },
            rtp: { type: 'number' },
            is_active: { type: 'boolean' },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  },
  responses: {
    '201': { description: 'Game created' },
    '400': { description: 'Validation error' },
  },
});

swagger.registerPath({
  method: 'put',
  path: '/api/admin/games/{id}',
  summary: 'Update game',
  tags: ['Admin Games'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            provider: { type: 'string' },
            rtp: { type: 'number' },
            is_active: { type: 'boolean' },
            metadata: { type: 'object', additionalProperties: true },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Game updated' },
  },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/games/{id}',
  summary: 'Get game by id',
  tags: ['Admin Games'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Game details' },
    '404': { description: 'Not found' },
  },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/games/{id}/toggle',
  summary: 'Toggle game active state',
  tags: ['Admin Games'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: false,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            is_active: { type: 'boolean' },
          },
        },
      },
    },
  },
  responses: {
    '200': { description: 'Game toggled' },
  },
});

swagger.registerPath({
  method: 'delete',
  path: '/api/admin/games/{id}',
  summary: 'Delete game',
  tags: ['Admin Games'],
  security: [{ bearerAuth: [] }],
  responses: {
    '200': { description: 'Game deleted' },
  },
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = listGamesSchema.parse(req.query);
    const out = await service.listGames(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.get('/list', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = listGamesSchema.parse({ ...req.query, page: 1, limit: 500 });
    const out = await service.listGames(req, params);
    res.json(out.items);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await service.getGame(req, req.params.id);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = createGameSchema.parse(req.body);
    const out = await service.createGame(req, body);
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = updateGameSchema.parse(req.body);
    const out = await service.updateGame(req, req.params.id, body);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await service.deleteGame(req, req.params.id);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

router.post(
  '/:id/toggle',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = toggleGameSchema.parse(req.body ?? {});
      const out = await service.toggleGame(req, req.params.id, body);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id/sessions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const params = listGameSessionsSchema.parse(req.query);
      const out = await service.gameSessions(req, req.params.id, params);
      res.json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
