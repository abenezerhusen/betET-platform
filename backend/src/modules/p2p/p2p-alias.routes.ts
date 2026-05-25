import { Router } from 'express';
import * as swagger from '../../swagger/registry';

import { authenticateToken } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/require-role';
import adminP2pRouter from '../admin/p2p/p2p.routes';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/p2p/wallets',
  summary: 'Legacy alias for admin P2P wallets',
  tags: ['P2P Alias'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Proxied admin p2p response' } },
});

const commandKindMap: Record<string, string> = {
  check_balance: 'check_balance',
  withdraw: 'withdraw',
  restart_device: 'restart',
  restart: 'restart',
  force_heartbeat: 'heartbeat',
  heartbeat: 'heartbeat',
};

/**
 * Backward-compatibility shim for legacy `/api/p2p/*` consumers.
 *
 * The canonical admin API stays `/api/admin/p2p/*`; this adapter rewrites old
 * URL/method/body shapes to the current admin router so service logic remains
 * single-sourced.
 */
router.use(authenticateToken());
router.use(requireRole('superadmin', 'tenant_admin'));

router.use((req, _res, next) => {
  const [rawPath, rawQuery = ''] = req.url.split('?');
  let path = rawPath || '/';
  let method = req.method.toUpperCase();

  // Endpoint name aliases
  if (path === '/devices') path = '/wallets';
  if (path === '/wallet-devices') path = '/wallets';
  if (path.startsWith('/devices/')) path = `/wallets/${path.slice('/devices/'.length)}`;

  path = path.replace(/\/top-up$/, '/topup');
  path = path.replace(/\/deposits\/queue$/, '/deposits');
  path = path.replace(/\/withdrawals\/queue$/, '/withdrawals');
  path = path.replace(/\/withdrawals\/([^/]+)\/switch-wallet$/, '/withdrawals/$1/switch');
  path = path.replace(/\/limits$/, '/settings');
  path = path.replace(/\/operators\/([^/]+)\/access\/send-link$/, '/operators/$1/access-tokens');
  path = path.replace(
    /\/operators\/([^/]+)\/access\/rotate$/,
    '/operators/$1/access-tokens/rotate'
  );

  if (path === '/deposits/queue') path = '/deposits';
  if (path === '/withdrawals/queue') path = '/withdrawals';
  // /transactions now has a dedicated unified handler in the canonical
  // admin router — leave the path alone and let it pass through.

  // Method aliases (legacy PATCH -> current POST/PUT handlers)
  if (
    method === 'PATCH' &&
    /^\/deposits\/[^/]+\/(approve|reject)$/.test(path)
  ) {
    method = 'POST';
  }
  if (
    method === 'PATCH' &&
    /^\/withdrawals\/[^/]+\/(approve|reject)$/.test(path)
  ) {
    method = 'POST';
  }
  if (method === 'PATCH' && path === '/settings') {
    method = 'PUT';
  }
  if (method === 'PATCH' && /^\/wallets\/[^/]+$/.test(path)) {
    method = 'PUT';
  }

  // Legacy per-wallet command endpoint:
  // POST /devices/:id/command { command_type, payload }
  const commandMatch = path.match(/^\/wallets\/([^/]+)\/command$/);
  if (method === 'POST' && commandMatch) {
    const commandType =
      typeof req.body?.command_type === 'string' ? req.body.command_type : '';
    path = '/commands';
    req.body = {
      agent_id: commandMatch[1],
      kind: commandKindMap[commandType] ?? commandType,
      payload:
        req.body && typeof req.body.payload === 'object' && req.body.payload
          ? req.body.payload
          : {},
      reference:
        typeof req.body?.reference === 'string' ? req.body.reference : undefined,
    };
  }

  // Legacy sub-account delete shape:
  // DELETE /devices/:id/accounts/:accountId -> DELETE /accounts/:accountId
  const accountDeleteMatch = path.match(/^\/wallets\/[^/]+\/accounts\/([^/]+)$/);
  if (method === 'DELETE' && accountDeleteMatch) {
    path = `/accounts/${accountDeleteMatch[1]}`;
  }

  // Keep query string intact after path rewrite.
  req.method = method;
  req.url = rawQuery ? `${path}?${rawQuery}` : path;
  next();
});

router.use('/', adminP2pRouter);

export default router;
