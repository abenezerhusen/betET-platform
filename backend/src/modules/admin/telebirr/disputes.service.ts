import type { Request } from 'express';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { confirmManualMatch } from '../../telebirr';
import * as disputesRepo from '../../telebirr/telebirr.disputes.repository';
import * as telebirrRepo from '../../telebirr/telebirr.repository';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

import type {
  InvestigateDisputeInput,
  ListDisputesQuery,
  ResolveCreditInput,
  ResolveRejectInput,
} from './disputes.dto';

/**
 * Window (minutes) used when the admin opens a dispute and we suggest
 * matching telebirr_sms_raw / telebirr_transactions rows. Generous
 * because users often dispute days after the original payment.
 */
const SUGGESTIONS_WINDOW_MINUTES = 24 * 60; // 24h

/* ------------------------------------------------------------------------- */
/* List                                                                      */
/* ------------------------------------------------------------------------- */

export async function listDisputes(req: Request, params: ListDisputesQuery) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  const offset = (params.page - 1) * params.limit;

  const data = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      disputesRepo.listDisputes(client, {
        tenantId,
        userId: params.user_id ?? null,
        status: params.status ?? null,
        search: params.search ?? null,
        from: params.from ?? null,
        to: params.to ?? null,
        limit: params.limit,
        offset,
      })
  );

  return {
    items: data.rows,
    total: data.total,
    page: params.page,
    limit: params.limit,
    pages: Math.max(1, Math.ceil(data.total / params.limit)),
  };
}

/* ------------------------------------------------------------------------- */
/* Get (with suggestions)                                                    */
/* ------------------------------------------------------------------------- */

export async function getDispute(req: Request, id: string) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const dispute = await disputesRepo.findDisputeById(client, tenantId, id);
      if (!dispute) throw new NotFoundError('Dispute not found');

      // Cheap user lookup — gives the admin UI the user's phone and
      // email next to the disputed payment without an extra round-trip.
      const userRes = await client.query<{
        id: string;
        email: string | null;
        phone: string | null;
      }>(
        `SELECT id, email::text AS email, phone FROM users WHERE id = $1 LIMIT 1`,
        [dispute.user_id]
      );

      const suggestions = await disputesRepo.findDisputeSuggestions(client, {
        tenantId,
        amount: dispute.amount,
        senderPhone: dispute.sender_telebirr_number,
        paidAt: dispute.paid_at,
        windowMinutes: SUGGESTIONS_WINDOW_MINUTES,
      });

      return {
        ...dispute,
        user: userRes.rows[0] ?? null,
        suggestions,
      };
    }
  );
}

/* ------------------------------------------------------------------------- */
/* Investigate                                                               */
/* ------------------------------------------------------------------------- */

export async function investigate(
  req: Request,
  id: string,
  body: InvestigateDisputeInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const updated = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const existing = await disputesRepo.findDisputeById(
        client,
        tenantId,
        id
      );
      if (!existing) throw new NotFoundError('Dispute not found');
      if (existing.status !== 'open') {
        throw new BadRequestError(
          `Cannot move to investigating from ${existing.status}`,
          { reason: 'invalid_state', status: existing.status }
        );
      }
      return disputesRepo.setDisputeStatus(client, {
        id,
        status: 'investigating',
        resolvedBy: scope.actorId,
        resolvedTelebirrTxId: null,
        resolutionNotes: body.notes ?? null,
      });
    }
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.telebirr.dispute.investigate',
      resource: 'telebirr_dispute',
      resourceId: id,
      payload: { notes: body.notes ?? null },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return updated;
}

/* ------------------------------------------------------------------------- */
/* Resolve — credit                                                          */
/* ------------------------------------------------------------------------- */

export async function resolveCredit(
  req: Request,
  id: string,
  body: ResolveCreditInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  // 1. Load + sanity-check the dispute and the target tx.
  const { dispute, tx } = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const d = await disputesRepo.findDisputeById(client, tenantId, id);
      if (!d) throw new NotFoundError('Dispute not found');
      if (d.status !== 'open' && d.status !== 'investigating') {
        throw new BadRequestError(
          `Dispute is in status ${d.status}; cannot credit`,
          { reason: 'invalid_state', status: d.status }
        );
      }
      const t = await telebirrRepo.findTelebirrTxByIdInTenant(
        client,
        tenantId,
        body.telebirr_transaction_id
      );
      if (!t) throw new NotFoundError('Linked Telebirr transaction not found');
      // Belt-and-braces: amounts must match. Sender phone is best-effort
      // (the user's claimed phone may differ subtly from what Telebirr
      // logged); we surface it in the dispute audit but don't reject.
      if (Number(t.amount) !== Number(d.amount)) {
        throw new BadRequestError(
          'Dispute and linked transaction amounts disagree',
          {
            reason: 'amount_mismatch',
            dispute_amount: d.amount,
            tx_amount: t.amount,
          }
        );
      }
      if (
        t.status !== 'pending' &&
        t.status !== 'unmatched' &&
        t.status !== 'disputed'
      ) {
        throw new BadRequestError(
          `Linked transaction is in status ${t.status}; only pending/unmatched/disputed can be credited`,
          { reason: 'tx_invalid_status', status: t.status }
        );
      }
      return { dispute: d, tx: t };
    }
  );

  // 2. Reuse the same atomic credit pipeline cashier-side manual match
  //    uses. This guarantees identical audit + socket emit behaviour.
  const matchResult = await confirmManualMatch(
    tenantId,
    tx.telebirr_ref,
    dispute.user_id,
    {
      actorType: 'admin',
      actorId: scope.actorId,
      ip: getIp(req),
      userAgent: getUa(req),
    }
  );
  if (matchResult.outcome === 'rejected') {
    throw new BadRequestError(matchResult.reason, {
      reason: 'manual_match_rejected',
    });
  }

  // 3. Mark the dispute resolved + cross-link the credited tx.
  const resolved = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) =>
      disputesRepo.setDisputeStatus(client, {
        id,
        status: 'resolved_credited',
        resolvedBy: scope.actorId,
        resolvedTelebirrTxId: matchResult.telebirrTransactionId,
        resolutionNotes: body.notes ?? null,
      })
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.telebirr.dispute.resolve_credited',
      resource: 'telebirr_dispute',
      resourceId: id,
      payload: {
        telebirr_transaction_id: matchResult.telebirrTransactionId,
        credit_transaction_id: matchResult.creditTransactionId,
        amount: dispute.amount,
        currency: 'ETB',
        notes: body.notes ?? null,
        match_outcome: matchResult.outcome,
      },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return {
    dispute: resolved,
    match: {
      outcome: matchResult.outcome,
      telebirr_transaction_id: matchResult.telebirrTransactionId,
      credit_transaction_id: matchResult.creditTransactionId,
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Resolve — reject                                                          */
/* ------------------------------------------------------------------------- */

export async function resolveReject(
  req: Request,
  id: string,
  body: ResolveRejectInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const updated = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const existing = await disputesRepo.findDisputeById(client, tenantId, id);
      if (!existing) throw new NotFoundError('Dispute not found');
      if (
        existing.status !== 'open' &&
        existing.status !== 'investigating'
      ) {
        throw new BadRequestError(
          `Dispute is in status ${existing.status}; cannot reject`,
          { reason: 'invalid_state', status: existing.status }
        );
      }
      return disputesRepo.setDisputeStatus(client, {
        id,
        status: 'resolved_rejected',
        resolvedBy: scope.actorId,
        resolvedTelebirrTxId: null,
        resolutionNotes: body.notes,
      });
    }
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.telebirr.dispute.resolve_rejected',
      resource: 'telebirr_dispute',
      resourceId: id,
      payload: { notes: body.notes },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return updated;
}
