/**
 * Admin Settlement Routes — /api/admin/settlement/*
 *
 * Accessible only by superadmin and tenant_admin (enforced at the
 * admin router level in admin.routes.ts).
 *
 * Endpoints:
 *   GET  /tickets              list unsettled + error tickets
 *   GET  /tickets/:id          ticket detail with legs + audit
 *   POST /tickets/:id/settle   settle a ticket now
 *   POST /tickets/:id/void-selection/:legId  void one selection
 *   POST /tickets/:id/void-ticket  fully void ticket + refund
 *   POST /tickets/:id/recalculate  recalculate odds
 *   POST /tickets/:id/extend-wait extend postponement window
 *   POST /tickets/:id/force-win   admin force win
 *   POST /tickets/:id/force-lose  admin force lose
 *   POST /tickets/:id/refund-stake refund stake only
 *   POST /tickets/:id/reopen  reopen settled ticket
 *   POST /tickets/:id/resettle  resettle ticket
 *   POST /tickets/:id/manual-review flag for manual review
 *   POST /events/:eventId/postpone  mark event postponed
 *   POST /events/:eventId/cancel    mark event cancelled
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { getAdminScope, requireScopedTenantId } from '../admin-shared';
import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { NotFoundError, BadRequestError } from '../../../http/errors/http-error';
import {
  listSettlementTickets,
  getSettlementTicket,
  settleBetFromLegs,
  voidSelection,
  recalculateOdds,
  creditWallet,
  releaseLockedBalance,
  writeAuditLog,
  handleEventPostponed,
  handleEventCancelled,
  expirePostponedSelections,
} from './settlement.service';

const router = Router();

/* ------------------------------------------------------------------ */
/* GET /api/admin/settlement/tickets                                    */
/* ------------------------------------------------------------------ */

router.get('/tickets', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);

    const query = z.object({
      filter: z.enum(['unsettled', 'errors', 'all']).default('unsettled'),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);

    const result = await listSettlementTickets({
      tenantId,
      filter: query.filter,
      page: query.page,
      limit: query.limit,
    });

    res.json(result);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/admin/settlement/tickets/:id                               */
/* ------------------------------------------------------------------ */

router.get('/tickets/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const ticket = await getSettlementTicket({ tenantId, betId: req.params.id });
    if (!ticket) throw new NotFoundError('Ticket not found');
    res.json(ticket);
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/tickets/:id/settle                       */
/* ------------------------------------------------------------------ */

router.post('/tickets/:id/settle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = z.object({ reason: z.string().default('admin_manual_settle') }).parse(req.body);

    const result = await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        return settleBetFromLegs(client, {
          tenantId,
          betId: req.params.id,
          actorId: scope.actorId,
          reason: body.reason,
        });
      }
    );

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/tickets/:id/void-selection/:legId        */
/* ------------------------------------------------------------------ */

router.post(
  '/tickets/:id/void-selection/:legId',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getAdminScope(req);
      const tenantId = requireScopedTenantId(scope);
      const body = z.object({ reason: z.string().min(1) }).parse(req.body);

      await withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
        await voidSelection(client, {
          tenantId,
          betId: req.params.id,
          legId: req.params.legId,
          reason: body.reason,
          actorId: scope.actorId,
        });
        await recalculateOdds(client, req.params.id);
      });

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/tickets/:id/void-ticket                  */
/* ------------------------------------------------------------------ */

router.post('/tickets/:id/void-ticket', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = z.object({ reason: z.string().min(1) }).parse(req.body);

    await withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const betRow = await client.query<{
        id: string;
        user_id: string;
        stake: string;
        currency: string;
        status: string;
        settlement_status: string | null;
      }>(
        `SELECT id, user_id, stake::text, currency, status, settlement_status
           FROM sportsbook_bets WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const bet = betRow.rows[0];
      if (!bet) throw new NotFoundError('Ticket not found');

      const oldStatus = bet.settlement_status ?? bet.status;

      // Void all pending legs
      await client.query(
        `UPDATE sportsbook_bet_legs
            SET status = 'void', selection_status = 'voided',
                settled_odds = 1.00, void_reason = $1, settled_at = now()
          WHERE bet_id = $2 AND status IN ('pending','won','lost')`,
        [body.reason, bet.id]
      );

      await client.query(
        `UPDATE sportsbook_bets
            SET status = 'void',
                settlement_status = 'fully_voided',
                void_reason = $1,
                actual_payout = stake,
                recalculated_odds = 1.00,
                settled_at = now(),
                settled_by = $2,
                settlement_reason = $3,
                updated_at = now()
          WHERE id = $4`,
        [body.reason, scope.actorId, body.reason, bet.id]
      );

      // Refund stake
      await creditWallet(client, {
        tenantId,
        userId: bet.user_id,
        currency: bet.currency,
        betId: bet.id,
        stake: Number(bet.stake),
        credit: Number(bet.stake),
        txType: 'bet_refund',
        reason: `void_ticket: ${body.reason}`,
      });

      await writeAuditLog(client, {
        tenantId,
        betId: bet.id,
        actorId: scope.actorId,
        action: 'void_ticket',
        oldStatus,
        newStatus: 'fully_voided',
        stake: Number(bet.stake),
        recalculatedPayout: Number(bet.stake),
        voidReason: body.reason,
      });
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/tickets/:id/recalculate                  */
/* ------------------------------------------------------------------ */

router.post('/tickets/:id/recalculate', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);

    const newOdds = await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      (client) => recalculateOdds(client, req.params.id)
    );

    res.json({ success: true, recalculated_odds: newOdds });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/tickets/:id/extend-wait                  */
/* ------------------------------------------------------------------ */

router.post('/tickets/:id/extend-wait', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = z.object({
      wait_hours: z.number().int().min(1).max(168),
    }).parse(req.body);

    await withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const r = await client.query(
        `UPDATE sportsbook_bets
            SET postpone_wait_hours = $1, updated_at = now()
          WHERE id = $2
          RETURNING id`,
        [body.wait_hours, req.params.id]
      );
      if (!r.rows[0]) throw new NotFoundError('Ticket not found');

      await writeAuditLog(client, {
        tenantId,
        betId: req.params.id,
        actorId: scope.actorId,
        action: 'extend_wait',
        settlementReason: `Extended postponement window to ${body.wait_hours}h`,
        metadata: { wait_hours: body.wait_hours },
      });
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/tickets/:id/force-win                    */
/* ------------------------------------------------------------------ */

router.post('/tickets/:id/force-win', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = z.object({
      payout: z.number().positive(),
      reason: z.string().default('admin_force_win'),
    }).parse(req.body);

    await withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const betRow = await client.query<{
        id: string; user_id: string; stake: string; currency: string;
        status: string; settlement_status: string | null; potential_payout: string;
      }>(
        `SELECT id, user_id, stake::text, currency, status, settlement_status,
                potential_payout::text
           FROM sportsbook_bets WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const bet = betRow.rows[0];
      if (!bet) throw new NotFoundError('Ticket not found');

      await client.query(
        `UPDATE sportsbook_bets
            SET status = 'won', settlement_status = 'won',
                actual_payout = $1, settled_at = now(), settled_by = $2,
                settlement_reason = $3, updated_at = now()
          WHERE id = $4`,
        [body.payout, scope.actorId, body.reason, bet.id]
      );

      await creditWallet(client, {
        tenantId,
        userId: bet.user_id,
        currency: bet.currency,
        betId: bet.id,
        stake: Number(bet.stake),
        credit: body.payout,
        txType: 'bet_win',
        reason: body.reason,
      });

      await writeAuditLog(client, {
        tenantId,
        betId: bet.id,
        actorId: scope.actorId,
        action: 'force_win',
        oldStatus: bet.settlement_status ?? bet.status,
        newStatus: 'won',
        stake: Number(bet.stake),
        originalPayout: Number(bet.potential_payout),
        recalculatedPayout: body.payout,
        settlementReason: body.reason,
      });
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/tickets/:id/force-lose                   */
/* ------------------------------------------------------------------ */

router.post('/tickets/:id/force-lose', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = z.object({ reason: z.string().default('admin_force_lose') }).parse(req.body);

    await withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const betRow = await client.query<{
        id: string; user_id: string; stake: string; currency: string;
        status: string; settlement_status: string | null;
      }>(
        `SELECT id, user_id, stake::text, currency, status, settlement_status
           FROM sportsbook_bets WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const bet = betRow.rows[0];
      if (!bet) throw new NotFoundError('Ticket not found');

      await client.query(
        `UPDATE sportsbook_bets
            SET status = 'lost', settlement_status = 'lost',
                actual_payout = 0, settled_at = now(), settled_by = $1,
                settlement_reason = $2, updated_at = now()
          WHERE id = $3`,
        [scope.actorId, body.reason, bet.id]
      );

      await releaseLockedBalance(client, {
        userId: bet.user_id,
        currency: bet.currency,
        stake: Number(bet.stake),
      });

      await writeAuditLog(client, {
        tenantId,
        betId: bet.id,
        actorId: scope.actorId,
        action: 'force_lose',
        oldStatus: bet.settlement_status ?? bet.status,
        newStatus: 'lost',
        stake: Number(bet.stake),
        settlementReason: body.reason,
      });
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/tickets/:id/refund-stake                 */
/* ------------------------------------------------------------------ */

router.post('/tickets/:id/refund-stake', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = z.object({ reason: z.string().default('admin_refund') }).parse(req.body);

    await withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const betRow = await client.query<{
        id: string; user_id: string; stake: string; currency: string;
        status: string; settlement_status: string | null;
      }>(
        `SELECT id, user_id, stake::text, currency, status, settlement_status
           FROM sportsbook_bets WHERE id = $1 FOR UPDATE`,
        [req.params.id]
      );
      const bet = betRow.rows[0];
      if (!bet) throw new NotFoundError('Ticket not found');

      await client.query(
        `UPDATE sportsbook_bets
            SET status = 'void', settlement_status = 'refunded',
                actual_payout = stake, settled_at = now(), settled_by = $1,
                settlement_reason = $2, updated_at = now()
          WHERE id = $3`,
        [scope.actorId, body.reason, bet.id]
      );

      await creditWallet(client, {
        tenantId,
        userId: bet.user_id,
        currency: bet.currency,
        betId: bet.id,
        stake: Number(bet.stake),
        credit: Number(bet.stake),
        txType: 'bet_refund',
        reason: body.reason,
      });

      await writeAuditLog(client, {
        tenantId,
        betId: bet.id,
        actorId: scope.actorId,
        action: 'refund_stake',
        oldStatus: bet.settlement_status ?? bet.status,
        newStatus: 'refunded',
        stake: Number(bet.stake),
        recalculatedPayout: Number(bet.stake),
        settlementReason: body.reason,
      });
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/tickets/:id/reopen                       */
/* ------------------------------------------------------------------ */

router.post('/tickets/:id/reopen', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = z.object({ reason: z.string().default('admin_reopen') }).parse(req.body);

    await withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const betRow = await client.query(
        `UPDATE sportsbook_bets
            SET status = 'pending', settlement_status = 'awaiting_settlement',
                actual_payout = NULL, settled_at = NULL, settled_by = $1,
                settlement_reason = $2, updated_at = now()
          WHERE id = $3
          RETURNING id`,
        [scope.actorId, body.reason, req.params.id]
      );
      if (!betRow.rows[0]) throw new NotFoundError('Ticket not found');

      await writeAuditLog(client, {
        tenantId,
        betId: req.params.id,
        actorId: scope.actorId,
        action: 'reopen',
        newStatus: 'awaiting_settlement',
        settlementReason: body.reason,
      });
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/tickets/:id/resettle                     */
/* ------------------------------------------------------------------ */

router.post('/tickets/:id/resettle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);
    const body = z.object({ reason: z.string().default('admin_resettle') }).parse(req.body);

    const result = await withTenantClient(
      { tenantId, bypassRls: scope.bypassRls },
      async (client) => {
        // Reopen first
        await client.query(
          `UPDATE sportsbook_bets
              SET status = 'pending', settlement_status = 'awaiting_settlement',
                  actual_payout = NULL, settled_at = NULL, updated_at = now()
            WHERE id = $1`,
          [req.params.id]
        );

        return settleBetFromLegs(client, {
          tenantId,
          betId: req.params.id,
          actorId: scope.actorId,
          reason: body.reason,
        });
      }
    );

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/tickets/:id/manual-review                */
/* ------------------------------------------------------------------ */

router.post(
  '/tickets/:id/manual-review',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getAdminScope(req);
      const tenantId = requireScopedTenantId(scope);
      const body = z.object({ reason: z.string().default('flagged_for_review') }).parse(req.body);

      await withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
        const r = await client.query(
          `UPDATE sportsbook_bets
              SET settlement_status = 'manual_review',
                  review_required = true,
                  settlement_reason = $1,
                  updated_at = now()
            WHERE id = $2
            RETURNING id`,
          [body.reason, req.params.id]
        );
        if (!r.rows[0]) throw new NotFoundError('Ticket not found');

        await writeAuditLog(client, {
          tenantId,
          betId: req.params.id,
          actorId: scope.actorId,
          action: 'send_to_manual_review',
          newStatus: 'manual_review',
          settlementReason: body.reason,
        });
      });

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/events/:eventId/postpone                 */
/* ------------------------------------------------------------------ */

router.post(
  '/events/:eventId/postpone',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getAdminScope(req);
      const tenantId = requireScopedTenantId(scope);
      const body = z
        .object({ wait_hours: z.number().int().min(1).max(720).optional() })
        .parse(req.body);

      // Use explicit wait_hours if provided; otherwise fall back to the
      // tenant's `settlement.config.postponement_wait_hours` setting (default 48h).
      let waitHours = body.wait_hours;
      if (!waitHours) {
        const cfgRow = await withTenantClient({ tenantId }, async (cl) =>
          cl.query<{ value: unknown }>(
            `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'settlement.config' LIMIT 1`,
            [tenantId]
          )
        );
        const cfg = (cfgRow.rows[0]?.value ?? {}) as Record<string, unknown>;
        waitHours =
          typeof cfg.postponement_wait_hours === 'number'
            ? cfg.postponement_wait_hours
            : 48;
      }

      const affected = await handleEventPostponed({
        tenantId,
        eventId: req.params.eventId,
        waitHours,
        actorId: scope.actorId,
      });

      res.json({ success: true, affected_tickets: affected });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/events/:eventId/cancel                   */
/* ------------------------------------------------------------------ */

router.post(
  '/events/:eventId/cancel',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getAdminScope(req);
      const tenantId = requireScopedTenantId(scope);

      const result = await handleEventCancelled({
        tenantId,
        eventId: req.params.eventId,
        actorId: scope.actorId,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* POST /api/admin/settlement/run-auto-settle  (manual trigger)        */
/* ------------------------------------------------------------------ */

router.post(
  '/run-auto-settle',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const scope = getAdminScope(req);
      const tenantId = requireScopedTenantId(scope);

      const count = await expirePostponedSelections({
        tenantId,
        actorId: scope.actorId,
      });

      res.json({ success: true, processed: count });
    } catch (err) {
      next(err);
    }
  }
);

/* ------------------------------------------------------------------ */
/* GET /api/admin/settlement/audit-logs                                 */
/* ------------------------------------------------------------------ */

router.get('/audit-logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const scope = getAdminScope(req);
    const tenantId = requireScopedTenantId(scope);

    const query = z.object({
      bet_id: z.string().uuid().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(req.query);

    await withTenantClient({ tenantId, bypassRls: scope.bypassRls }, async (client) => {
      const offset = (query.page - 1) * query.limit;
      const whereExtra = query.bet_id ? `AND bet_id = '${query.bet_id}'` : '';

      const countRow = await client.query<{ total: string }>(
        `SELECT COUNT(*) AS total FROM settlement_audit_logs
          WHERE tenant_id = $1 ${whereExtra}`,
        [tenantId]
      );

      const rows = await client.query(
        `SELECT sal.id, sal.bet_id, sal.leg_id, sal.action,
                sal.old_status, sal.new_status, sal.old_odds::text,
                sal.new_odds::text, sal.stake::text,
                sal.original_payout::text, sal.recalculated_payout::text,
                sal.void_reason, sal.settlement_reason, sal.metadata,
                sal.created_at,
                u.email AS actor_email, u.role AS actor_role
           FROM settlement_audit_logs sal
           LEFT JOIN users u ON u.id = sal.actor_id
          WHERE sal.tenant_id = $1 ${whereExtra}
          ORDER BY sal.created_at DESC
          LIMIT $2 OFFSET $3`,
        [tenantId, query.limit, offset]
      );

      res.json({
        items: rows.rows,
        total: Number(countRow.rows[0]?.total ?? 0),
        page: query.page,
        limit: query.limit,
      });
    });
  } catch (err) {
    next(err);
  }
});

export default router;
