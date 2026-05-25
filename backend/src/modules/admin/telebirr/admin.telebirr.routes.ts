import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from 'express';

import {
  agentIdParamSchema,
  createAgentSchema,
  disputeTransactionSchema,
  listAdminTransactionsQuerySchema,
  listAgentsQuerySchema,
  listRawSmsQuerySchema,
  reportsQuerySchema,
  toggleAgentSchema,
  transactionIdParamSchema,
  updateAgentSchema,
  updateTelebirrSettingsSchema,
} from './admin.telebirr.dto';
import * as agents from './agents.service';
import * as transactions from './transactions.service';
import * as reports from './reports.service';
import * as settings from './settings.service';
import * as disputes from './disputes.service';
import * as reconciliation from './reconciliation.service';
import * as withdrawals from './withdrawals.service';
import {
  adminCancelWithdrawalSchema,
  listWithdrawalsQuerySchema,
  withdrawalIdParamSchema,
} from './withdrawals.dto';
import {
  disputeIdParamSchema as disputeIdParam,
  investigateDisputeSchema,
  listDisputesQuerySchema,
  resolveCreditSchema,
  resolveRejectSchema,
} from './disputes.dto';
import {
  attachStatementSchema,
  listReconciliationQuerySchema,
  reconciliationIdParamSchema,
  resolveReconciliationSchema,
  runReconciliationSchema,
} from './reconciliation.dto';
import * as swagger from '../../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/admin/telebirr/agents',
  summary: 'List Telebirr agents',
  tags: ['Admin Telebirr'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Agents list' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/telebirr/agents',
  summary: 'Create Telebirr agent',
  tags: ['Admin Telebirr'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object', additionalProperties: true },
      },
    },
  },
  responses: { '201': { description: 'Agent created' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/telebirr/transactions',
  summary: 'List Telebirr transactions',
  tags: ['Admin Telebirr'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Transactions list' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/telebirr/transactions/{id}/dispute',
  summary: 'Open Telebirr transaction dispute',
  tags: ['Admin Telebirr'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object', additionalProperties: true },
      },
    },
  },
  responses: { '200': { description: 'Dispute created' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/telebirr/settings',
  summary: 'Get Telebirr settings',
  tags: ['Admin Telebirr'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Settings payload' } },
});

swagger.registerPath({
  method: 'put',
  path: '/api/admin/telebirr/settings',
  summary: 'Update Telebirr settings',
  tags: ['Admin Telebirr'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object', additionalProperties: true },
      },
    },
  },
  responses: { '200': { description: 'Settings updated' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/telebirr/disputes',
  summary: 'List Telebirr disputes',
  tags: ['Admin Telebirr'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Disputes list' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/telebirr/reconciliation',
  summary: 'List reconciliation reports',
  tags: ['Admin Telebirr'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Reconciliation list' } },
});

swagger.registerPath({
  method: 'post',
  path: '/api/admin/telebirr/reconciliation/run',
  summary: 'Run reconciliation job',
  tags: ['Admin Telebirr'],
  security: [{ bearerAuth: [] }],
  requestBody: {
    required: true,
    content: {
      'application/json': {
        schema: { type: 'object', additionalProperties: true },
      },
    },
  },
  responses: { '200': { description: 'Reconciliation run complete' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/admin/telebirr/withdrawals',
  summary: 'List Telebirr withdrawals',
  tags: ['Admin Telebirr'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Withdrawals list' } },
});

/* ------------------------------------------------------------------------- */
/* Agents                                                                    */
/* ------------------------------------------------------------------------- */

router.get(
  '/agents',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listAgentsQuerySchema.parse(req.query);
      res.json(await agents.listAgents(req, query));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/agents',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createAgentSchema.parse(req.body);
      const out = await agents.createAgent(req, body);
      res.status(201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/agents/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = agentIdParamSchema.parse(req.params);
      const body = updateAgentSchema.parse(req.body);
      res.json(await agents.updateAgent(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/agents/:id/toggle',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = agentIdParamSchema.parse(req.params);
      const body = toggleAgentSchema.parse(req.body);
      res.json(await agents.toggleAgentStatus(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/agents/:id/reset-token',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = agentIdParamSchema.parse(req.params);
      res.json(await agents.resetAgentToken(req, id));
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------------- */
/* Transactions / raw SMS / disputes                                         */
/* ------------------------------------------------------------------------- */

router.get(
  '/transactions',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listAdminTransactionsQuerySchema.parse(req.query);
      res.json(await transactions.listTransactions(req, query));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/raw-sms',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listRawSmsQuerySchema.parse(req.query);
      res.json(await transactions.listRawSms(req, query));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/transactions/:id/dispute',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = transactionIdParamSchema.parse(req.params);
      const body = disputeTransactionSchema.parse(req.body);
      res.json(await transactions.disputeTransaction(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------------- */
/* Reports                                                                   */
/* ------------------------------------------------------------------------- */

router.get(
  '/reports',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = reportsQuerySchema.parse(req.query);
      res.json(await reports.getReports(req, query));
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------------- */
/* Settings                                                                  */
/* ------------------------------------------------------------------------- */

router.get(
  '/settings',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await settings.getSettings(req));
    } catch (err) {
      next(err);
    }
  }
);

router.put(
  '/settings',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = updateTelebirrSettingsSchema.parse(req.body);
      res.json(await settings.updateSettings(req, body));
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------------- */
/* Disputes                                                                  */
/* ------------------------------------------------------------------------- */

router.get(
  '/disputes',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listDisputesQuerySchema.parse(req.query);
      res.json(await disputes.listDisputes(req, query));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/disputes/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = disputeIdParam.parse(req.params);
      res.json(await disputes.getDispute(req, id));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/disputes/:id/investigate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = disputeIdParam.parse(req.params);
      const body = investigateDisputeSchema.parse(req.body);
      res.json(await disputes.investigate(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/disputes/:id/resolve-credit',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = disputeIdParam.parse(req.params);
      const body = resolveCreditSchema.parse(req.body);
      res.json(await disputes.resolveCredit(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/disputes/:id/resolve-reject',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = disputeIdParam.parse(req.params);
      const body = resolveRejectSchema.parse(req.body);
      res.json(await disputes.resolveReject(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------------- */
/* Reconciliation                                                            */
/* ------------------------------------------------------------------------- */

router.get(
  '/reconciliation',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listReconciliationQuerySchema.parse(req.query);
      res.json(await reconciliation.listReports(req, query));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/reconciliation/run',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = runReconciliationSchema.parse(req.body);
      res.json(await reconciliation.runReconciliation(req, body));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/reconciliation/statement',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = attachStatementSchema.parse(req.body);
      res.json(await reconciliation.attachStatement(req, body));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/reconciliation/:id/resolve',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = reconciliationIdParamSchema.parse(req.params);
      const body = resolveReconciliationSchema.parse(req.body);
      res.json(await reconciliation.resolveReport(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------------- */
/* Withdrawals                                                               */
/* ------------------------------------------------------------------------- */

router.get(
  '/withdrawals',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const query = listWithdrawalsQuerySchema.parse(req.query);
      res.json(await withdrawals.listWithdrawals(req, query));
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/withdrawals/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = withdrawalIdParamSchema.parse(req.params);
      res.json(await withdrawals.getWithdrawal(req, id));
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/withdrawals/:id/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = withdrawalIdParamSchema.parse(req.params);
      const body = adminCancelWithdrawalSchema.parse(req.body);
      res.json(await withdrawals.adminCancel(req, id, body));
    } catch (err) {
      next(err);
    }
  }
);

export default router;
