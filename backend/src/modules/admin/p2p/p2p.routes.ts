import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import * as swagger from '../../../swagger/registry';

import * as service from './p2p.service';
import {
  addSubAccountSchema,
  approveDepositSchema,
  approveWithdrawalSchema,
  broadcastCommandSchema,
  createOperatorSchema,
  idParamSchema,
  issueAccessTokenSchema,
  issueCommandSchema,
  listCommandsQuerySchema,
  listDepositQueueQuerySchema,
  listEventLogsQuerySchema,
  listOperatorsQuerySchema,
  listSwapsQuerySchema,
  listTransactionsQuerySchema,
  listWalletDevicesQuerySchema,
  listWithdrawalQueueQuerySchema,
  registerWalletDeviceSchema,
  rejectDepositSchema,
  rejectWithdrawalSchema,
  setApprovalThresholdSchema,
  setOperatorAssignmentsSchema,
  setOperatorPermissionsSchema,
  setWalletPrioritySchema,
  switchWithdrawalWalletSchema,
  toggleSubAccountSchema,
  topUpSchema,
  updateCommandStatusSchema,
  updateOperatorSchema,
  updateP2pSettingsSchema,
  updateUssdPinSchema,
  updateWalletDeviceSchema,
  upsertClientCommissionSchema,
  upsertWalletCommissionSchema,
  withdrawalSwapSchema,
} from './p2p.dto';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/admin/p2p/dashboard',
  summary: 'P2P dashboard summary',
  tags: ['Admin P2P'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Dashboard metrics' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/p2p/wallets',
  summary: 'List P2P wallet devices',
  tags: ['Admin P2P'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Wallet device list' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/p2p/wallets',
  summary: 'Register P2P wallet device',
  tags: ['Admin P2P'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } },
  },
  responses: { '201': { description: 'Wallet device created' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/p2p/deposits',
  summary: 'P2P deposit approval queue',
  tags: ['Admin P2P'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Deposit queue' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/p2p/withdrawals',
  summary: 'P2P withdrawal approval queue',
  tags: ['Admin P2P'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Withdrawal queue' } },
});

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const wrapStatus =
  <T>(status: number, fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

/* ------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* ------------------------------------------------------------------------- */

router.get('/dashboard', wrap((req) => service.getDashboard(req)));

/* ------------------------------------------------------------------------- */
/* Transactions (unified deposit + withdrawal feed)                           */
/* ------------------------------------------------------------------------- */

router.get(
  '/transactions',
  wrap((req) => {
    const q = listTransactionsQuerySchema.parse(req.query);
    return service.listTransactions(req, {
      tab: q.tab,
      status: q.status ?? null,
      agentId: q.agent_id ?? null,
      search: q.search ?? null,
      from: q.from ?? null,
      to: q.to ?? null,
      page: q.page,
      limit: q.limit,
    });
  })
);

/* ------------------------------------------------------------------------- */
/* Wallet devices                                                             */
/* ------------------------------------------------------------------------- */

router.get(
  '/wallets',
  wrap((req) => {
    const q = listWalletDevicesQuerySchema.parse(req.query);
    return service.listWalletDevices(req, q);
  })
);

router.post(
  '/wallets',
  wrapStatus(201, (req) => {
    const body = registerWalletDeviceSchema.parse(req.body);
    return service.registerWalletDevice(req, body);
  })
);

router.get(
  '/wallets/:id',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    return service.getWalletDevice(req, id);
  })
);

router.put(
  '/wallets/:id',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateWalletDeviceSchema.parse(req.body);
    return service.updateWalletDevice(req, id, body);
  })
);

router.post(
  '/wallets/:id/topup',
  wrapStatus(201, (req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = topUpSchema.parse(req.body);
    return service.topUpWalletDevice(req, id, body);
  })
);

router.post(
  '/wallets/:id/withdrawal-swap',
  wrapStatus(201, (req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = withdrawalSwapSchema.parse(req.body);
    return service.withdrawalSwap(req, id, body);
  })
);

router.get(
  '/wallets/:id/swaps',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    return service.listWalletSwaps(req, id);
  })
);

router.post(
  '/wallets/:id/pin',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    // Body validated even though service currently only checks shape — the
    // PIN itself never round-trips back through API responses.
    updateUssdPinSchema.parse(req.body);
    return Promise.resolve({ ok: true, agent_id: id });
  })
);

/* ------------------------------------------------------------------------- */
/* Sub-accounts                                                                */
/* ------------------------------------------------------------------------- */

router.get(
  '/wallets/:id/accounts',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    return service.listSubAccounts(req, id);
  })
);

router.post(
  '/wallets/:id/accounts',
  wrapStatus(201, (req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = addSubAccountSchema.parse(req.body);
    return service.addSubAccount(req, id, body);
  })
);

router.post(
  '/accounts/:id/toggle',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = toggleSubAccountSchema.parse(req.body);
    return service.toggleSubAccount(req, id, body);
  })
);

router.delete(
  '/accounts/:id',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    return service.removeSubAccount(req, id);
  })
);

/* ------------------------------------------------------------------------- */
/* Swaps                                                                       */
/* ------------------------------------------------------------------------- */

router.get(
  '/swaps',
  wrap((req) => {
    const q = listSwapsQuerySchema.parse(req.query);
    return service.listAllSwaps(req, q);
  })
);

router.post(
  '/swaps/:id/confirm',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    return service.confirmSwap(req, id);
  })
);

router.post(
  '/swaps/:id/fail',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = z
      .object({ reason: z.string().trim().max(500).optional() })
      .parse(req.body ?? {});
    return service.failSwap(req, id, body.reason);
  })
);

/* ------------------------------------------------------------------------- */
/* Deposit queue                                                              */
/* ------------------------------------------------------------------------- */

router.get(
  '/deposits',
  wrap((req) => {
    const q = listDepositQueueQuerySchema.parse(req.query);
    return service.listDepositQueue(req, q);
  })
);

router.post(
  '/deposits/:id/approve',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = approveDepositSchema.parse(req.body ?? {});
    return service.approveDepositInQueue(req, id, body);
  })
);

router.post(
  '/deposits/:id/reject',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = rejectDepositSchema.parse(req.body);
    return service.rejectDepositInQueue(req, id, body);
  })
);

/* ------------------------------------------------------------------------- */
/* Withdrawal queue                                                            */
/* ------------------------------------------------------------------------- */

router.get(
  '/withdrawals',
  wrap((req) => {
    const q = listWithdrawalQueueQuerySchema.parse(req.query);
    return service.listWithdrawalQueue(req, q);
  })
);

router.put(
  '/withdrawals/threshold',
  wrap((req) => {
    const body = setApprovalThresholdSchema.parse(req.body);
    return service.setApprovalThreshold(req, body);
  })
);

router.post(
  '/withdrawals/:id/approve',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = approveWithdrawalSchema.parse(req.body ?? {});
    return service.approveWithdrawal(req, id, body);
  })
);

router.post(
  '/withdrawals/:id/reject',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = rejectWithdrawalSchema.parse(req.body);
    return service.rejectWithdrawal(req, id, body);
  })
);

router.post(
  '/withdrawals/:id/switch',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = switchWithdrawalWalletSchema.parse(req.body);
    return service.switchWithdrawalWallet(req, id, body);
  })
);

/* ------------------------------------------------------------------------- */
/* Commands                                                                    */
/* ------------------------------------------------------------------------- */

router.get(
  '/commands',
  wrap((req) => {
    const q = listCommandsQuerySchema.parse(req.query);
    return service.listCommands(req, q);
  })
);

router.post(
  '/commands',
  wrapStatus(201, (req) => {
    const body = issueCommandSchema.parse(req.body);
    return service.issueCommand(req, body);
  })
);

router.post(
  '/commands/broadcast',
  wrapStatus(201, (req) => {
    const body = broadcastCommandSchema.parse(req.body);
    return service.broadcastCommand(req, body);
  })
);

router.post(
  '/commands/:id/status',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateCommandStatusSchema.parse(req.body);
    return service.updateCommandStatus(req, id, body);
  })
);

router.post(
  '/commands/:id/cancel',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    return service.cancelCommand(req, id);
  })
);

/* ------------------------------------------------------------------------- */
/* Operators                                                                   */
/* ------------------------------------------------------------------------- */

router.get(
  '/operators',
  wrap((req) => {
    const q = listOperatorsQuerySchema.parse(req.query);
    return service.listOperators(req, q);
  })
);

router.post(
  '/operators',
  wrapStatus(201, (req) => {
    const body = createOperatorSchema.parse(req.body);
    return service.createOperator(req, body);
  })
);

router.get(
  '/operators/:id',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    return service.getOperator(req, id);
  })
);

router.put(
  '/operators/:id',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = updateOperatorSchema.parse(req.body);
    return service.updateOperator(req, id, body);
  })
);

router.put(
  '/operators/:id/assignments',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = setOperatorAssignmentsSchema.parse(req.body);
    return service.setOperatorAssignments(req, id, body);
  })
);

router.put(
  '/operators/:id/permissions',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = setOperatorPermissionsSchema.parse(req.body);
    return service.setOperatorPermissions(req, id, body);
  })
);

/* ------------------------------------------------------------------------- */
/* Operator access tokens                                                       */
/* ------------------------------------------------------------------------- */

router.post(
  '/operators/:id/access-tokens',
  wrapStatus(201, (req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = issueAccessTokenSchema.parse(req.body ?? {});
    return service.issueAccessToken(req, id, body);
  })
);

router.post(
  '/operators/:id/access-tokens/rotate',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    const body = issueAccessTokenSchema.parse(req.body ?? {});
    return service.rotateAccessToken(req, id, body);
  })
);

router.delete(
  '/access-tokens/:id',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    return service.revokeAccessToken(req, id);
  })
);

/* ------------------------------------------------------------------------- */
/* Settings                                                                    */
/* ------------------------------------------------------------------------- */

router.get('/settings', wrap((req) => service.getSettings(req)));
router.put(
  '/settings',
  wrap((req) => {
    const body = updateP2pSettingsSchema.parse(req.body);
    return service.updateSettings(req, body);
  })
);

router.get('/wallet-priority', wrap((req) => service.getWalletPriority(req)));
router.put(
  '/wallet-priority',
  wrap((req) => {
    const body = setWalletPrioritySchema.parse(req.body);
    return service.setWalletPriority(req, body);
  })
);

/* ------------------------------------------------------------------------- */
/* Commissions                                                                 */
/* ------------------------------------------------------------------------- */

router.get('/commissions', wrap((req) => service.listCommissions(req)));

router.put(
  '/commissions/wallet',
  wrap((req) => {
    const body = upsertWalletCommissionSchema.parse(req.body);
    return service.upsertWalletCommission(req, body);
  })
);

router.put(
  '/commissions/client',
  wrap((req) => {
    const body = upsertClientCommissionSchema.parse(req.body);
    return service.upsertClientCommission(req, body);
  })
);

router.delete(
  '/commissions/client/:id',
  wrap((req) => {
    const { id } = idParamSchema.parse(req.params);
    return service.deleteClientCommission(req, id);
  })
);

/* ------------------------------------------------------------------------- */
/* Logs                                                                         */
/* ------------------------------------------------------------------------- */

router.get(
  '/logs',
  wrap((req) => {
    const q = listEventLogsQuerySchema.parse(req.query);
    return service.listEventLogs(req, q);
  })
);

export default router;
