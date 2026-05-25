import { Router } from 'express';
import { authenticateToken } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/require-role';
import operationsRouter from './operations.routes';
import usersRouter from './users.routes';
import shiftsRouter from './shifts.routes';
import transactionsRouter from './transactions.routes';
import telebirrRouter from './telebirr.routes';
import telebirrWithdrawalsRouter from './telebirr-withdrawals.routes';
import ticketsRouter from './tickets.routes';
import jackpotsRouter from './jackpots.routes';
import dashboardRouter from './dashboard.routes';
import branchWithdrawalRouter from './branch-withdrawal.routes';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/cashier',
  summary: 'Cashier API root',
  tags: ['Cashier'],
  security: [{ bearerAuth: [] }],
  responses: { '404': { description: 'Mountpoint only (no direct handler)' } },
});

// Cashier panel supports both cashier and sales roles.
router.use(authenticateToken());
router.use(requireRole('cashier', 'sales'));

// Top-level cash operations.
router.use('/', operationsRouter);

router.use('/users', usersRouter);
router.use('/shift', shiftsRouter);
router.use('/transactions', transactionsRouter);
router.use('/telebirr', telebirrRouter);
router.use('/telebirr', telebirrWithdrawalsRouter);

// Section 16 — cashier ticket lifecycle, jackpot sales, branch
// withdrawal codes, dashboard stats. All sit under /api/cashier/*.
router.use('/tickets', ticketsRouter);
router.use('/jackpots', jackpotsRouter);
router.use('/dashboard', dashboardRouter);
router.use('/withdrawal', branchWithdrawalRouter);

export default router;
