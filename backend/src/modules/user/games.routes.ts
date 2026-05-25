import { Router, type Request, type Response, type NextFunction } from 'express';
import { listGamesSchema } from './user.dto';
import { listGames } from './games.service';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/user/games',
  summary: 'List user-facing games',
  tags: ['User Games'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Games list' } },
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const params = listGamesSchema.parse(req.query);
    const out = await listGames(req, params);
    res.json(out);
  } catch (err) {
    next(err);
  }
});

export default router;
