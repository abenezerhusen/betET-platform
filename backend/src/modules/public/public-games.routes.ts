import { Router, type NextFunction, type Request, type Response } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError } from '../../http/errors/http-error';
import { listGamesSchema } from '../user/user.dto';
import * as repo from '../user/user.repository';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/public/games',
  summary: 'List active games for lobby/guest pages',
  tags: ['Public'],
  responses: { '200': { description: 'Games list' } },
});

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;
    if (!tenantId) {
      throw new BadRequestError('Tenant context required');
    }

    const params = listGamesSchema.parse(req.query);
    const offset = (params.page - 1) * params.limit;
    const data = await withTenantClient({ tenantId }, async (client) =>
      repo.listAvailableGames(client, tenantId, {
        type: params.type ?? null,
        provider: params.provider ?? null,
        search: params.search ?? null,
        limit: params.limit,
        offset,
      })
    );

    res.json({
      items: data.rows,
      total: data.total,
      page: params.page,
      limit: params.limit,
      pages: Math.max(1, Math.ceil(data.total / params.limit)),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
