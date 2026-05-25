import { Router } from 'express';
import { authenticateToken } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/require-role';
import profileRouter from './profile.routes';
import walletRouter from './wallet.routes';
import gamesRouter from './games.routes';
import betsRouter from './bets.routes';
import bonusesRouter from './bonuses.routes';
import depositsTelebirrRouter from './deposits-telebirr.routes';
import disputesTelebirrRouter from './disputes-telebirr.routes';
import withdrawalsTelebirrRouter from './withdrawals-telebirr.routes';
import paymentMethodsRouter from './payment-methods.routes';
import publicGamePicksRouter from '../public/game-picks/game-picks.module';
import tournamentsRouter from './tournaments.routes';
import branchWithdrawalRouter from './branch-withdrawal.routes';
import * as swagger from '../../swagger/registry';

const router = Router();

swagger.registerPath({
  method: 'get',
  path: '/api/user',
  summary: 'User API root',
  tags: ['User'],
  security: [{ bearerAuth: [] }],
  responses: { '404': { description: 'Mountpoint only (no direct handler)' } },
});

// All user-panel routes require an authenticated end-user. 'affiliate' is
// included so affiliate accounts can use the same self-service surface.
router.use(authenticateToken());
router.use(requireRole('user', 'affiliate'));

// Profile + wallet endpoints sit at the root: /me, /me/*, /wallet, /withdrawal/*
router.use('/', profileRouter);
router.use('/', walletRouter);

router.use('/games', gamesRouter);
router.use('/bets', betsRouter);
router.use('/bonuses', bonusesRouter);
router.use('/game-picks', publicGamePicksRouter);
router.use('/tournaments', tournamentsRouter);
router.use('/', depositsTelebirrRouter);
router.use('/', disputesTelebirrRouter);
router.use('/', withdrawalsTelebirrRouter);
router.use('/', paymentMethodsRouter);
// Section 16 — branch (cash) withdrawals: user requests a single-use
// code that any shop cashier can pay out via /api/cashier/withdrawal/*.
router.use('/', branchWithdrawalRouter);

export default router;
