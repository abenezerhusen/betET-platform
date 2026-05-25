/**
 * Operator-side public module.
 *
 * Backs the read-only `OperatorDashboard` page in the admin panel
 * (`/operator/dashboard?token=…`). Operators are P2P agents that may sign in
 * via a magic-link token issued by an admin — they never get a username /
 * password. The token is the bearer; we validate it via SHA-256 hash lookup
 * and return a per-operator dashboard payload.
 *
 * No JWT, no RLS bypass on writes. Reads are scoped to the operator's
 * tenant and only to the agents they have been assigned.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import crypto from 'node:crypto';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { ForbiddenError, UnauthorizedError } from '../../http/errors/http-error';
import * as p2pRepo from '../admin/p2p/p2p.repository';

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

const tokenSchema = z.object({
  token: z.string().trim().min(20).max(128),
});

interface OperatorContext {
  tenantId: string;
  operator: {
    id: string;
    name: string;
    email: string;
    role: string;
    status: string;
    permissions: string[];
  };
  tokenExpiresAt: Date;
  tokenTail: string;
  assignedAgentIds: string[];
}

/**
 * Resolve the bearer token (from `?token=`, `Authorization: Bearer …`, or an
 * `x-operator-token` header) to a live operator + assignment list. Throws
 * 401 when the token is missing/expired/revoked, 403 when the operator is
 * suspended or has no assignments.
 */
async function loadOperatorFromRequest(req: Request): Promise<OperatorContext> {
  const headerAuth = req.header('authorization');
  const bearer =
    headerAuth?.toLowerCase().startsWith('bearer ')
      ? headerAuth.slice(7).trim()
      : null;
  const headerTok = req.header('x-operator-token')?.trim() ?? null;
  const queryTok =
    typeof req.query.token === 'string' ? req.query.token.trim() : null;
  const candidate = bearer || headerTok || queryTok || '';

  if (!candidate) throw new UnauthorizedError('Missing operator token');
  const parsed = tokenSchema.safeParse({ token: candidate });
  if (!parsed.success) throw new UnauthorizedError('Invalid operator token');

  const tokenHash = sha256(parsed.data.token);

  return withTenantClient({ tenantId: null, bypassRls: true }, async (client) => {
    const tok = await p2pRepo.findAccessTokenByHash(client, tokenHash);
    if (!tok) throw new UnauthorizedError('Operator token not recognised');
    if (tok.revoked_at) throw new UnauthorizedError('Operator token revoked');
    if (tok.expires_at.getTime() < Date.now()) {
      throw new UnauthorizedError('Operator token expired');
    }

    const op = await p2pRepo.getOperator(client, tok.operator_id);
    if (!op) throw new UnauthorizedError('Operator not found');
    if (op.status !== 'active') {
      throw new ForbiddenError(`Operator account is ${op.status}`);
    }

    const assigned = await p2pRepo.getOperatorAssignments(client, op.id);
    await p2pRepo.touchAccessTokenLastUsed(client, tok.id);

    return {
      tenantId: op.tenant_id,
      operator: {
        id: op.id,
        name: op.name,
        email: op.email,
        role: op.role,
        status: op.status,
        permissions: op.permissions ?? [],
      },
      tokenExpiresAt: tok.expires_at,
      tokenTail: tok.token_tail,
      assignedAgentIds: assigned,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Dashboard payload                                                          */
/* -------------------------------------------------------------------------- */

async function buildDashboard(ctx: OperatorContext) {
  if (ctx.assignedAgentIds.length === 0) {
    return {
      operator: ctx.operator,
      session: {
        expires_at: ctx.tokenExpiresAt,
        token_tail: ctx.tokenTail,
      },
      device: null,
      metrics: null,
      capacity: null,
      revenue: null,
      swaps: [],
    };
  }

  return withTenantClient(
    { tenantId: ctx.tenantId, bypassRls: false, readOnly: true },
    async (client) => {
      // Pick the *first* assigned agent as the operator's primary device. The
      // dashboard UI is single-device by design.
      const agentId = ctx.assignedAgentIds[0];

      const agentRes = await client.query<{
        id: string;
        agent_name: string;
        telebirr_number: string;
        device_id: string;
        device_name: string | null;
        status: string;
        balance: string;
        last_seen_at: Date | null;
      }>(
        `SELECT id, agent_name, telebirr_number, device_id, device_name,
                status, balance::text AS balance, last_seen_at
           FROM telebirr_agents WHERE id = $1`,
        [agentId]
      );
      const agent = agentRes.rows[0] ?? null;

      // Per-tenant operating limits (max_daily_per_wallet acts as the
      // operator's "Total Capacity" for the day).
      const settingsRes = await client.query<{
        max_daily_per_wallet: string;
        manual_approval_threshold: string;
        default_deposit_commission_pct: string;
        default_withdrawal_commission_pct: string;
      }>(
        `SELECT max_daily_per_wallet::text, manual_approval_threshold::text,
                default_deposit_commission_pct::text,
                default_withdrawal_commission_pct::text
           FROM p2p_settings WHERE tenant_id = $1`,
        [ctx.tenantId]
      );
      const settings = settingsRes.rows[0] ?? null;

      const commRes = await client.query<{ deposit_pct: string; withdrawal_pct: string }>(
        `SELECT deposit_pct::text, withdrawal_pct::text
           FROM p2p_commissions
          WHERE tenant_id = $1 AND agent_id = $2`,
        [ctx.tenantId, agentId]
      );
      const commission = commRes.rows[0] ?? null;
      const depositPct = Number(
        commission?.deposit_pct ?? settings?.default_deposit_commission_pct ?? 0
      );

      // Capacity / used-today: sum credited deposits for this agent today.
      const usedTodayRes = await client.query<{ used: string }>(
        `SELECT COALESCE(SUM(amount), 0)::text AS used
           FROM telebirr_transactions
          WHERE agent_id = $1
            AND status IN ('matched','credited')
            AND created_at >= date_trunc('day', now())`,
        [agentId]
      );
      const usedToday = Number(usedTodayRes.rows[0]?.used ?? 0);
      const totalCapacity = Number(settings?.max_daily_per_wallet ?? 0);
      const availableCapacity = Math.max(0, totalCapacity - usedToday);

      // Revenue (credited deposit volume) for today / 7d / 30d.
      const revenueRes = await client.query<{
        today: string;
        d7: string;
        d30: string;
      }>(
        `SELECT
            COALESCE(SUM(amount) FILTER (
              WHERE created_at >= date_trunc('day', now())
            ), 0)::text AS today,
            COALESCE(SUM(amount) FILTER (
              WHERE created_at >= now() - interval '7 days'
            ), 0)::text AS d7,
            COALESCE(SUM(amount) FILTER (
              WHERE created_at >= now() - interval '30 days'
            ), 0)::text AS d30
           FROM telebirr_transactions
          WHERE agent_id = $1
            AND status IN ('matched','credited')`,
        [agentId]
      );
      const revenue = revenueRes.rows[0] ?? { today: '0', d7: '0', d30: '0' };

      // Commission earned = depositPct% of today's credited deposits.
      const commissionEarned = (
        (Number(revenue.today) * depositPct) /
        100
      ).toFixed(2);

      const swapsRes = await client.query<{
        id: string;
        amount: string;
        source: string;
        status: string;
        note: string | null;
        created_at: Date;
      }>(
        `SELECT id, amount::text AS amount, source, status, note, created_at
           FROM p2p_swaps
          WHERE agent_id = $1
          ORDER BY created_at DESC
          LIMIT 20`,
        [agentId]
      );

      return {
        operator: ctx.operator,
        session: {
          expires_at: ctx.tokenExpiresAt,
          token_tail: ctx.tokenTail,
        },
        device: agent
          ? {
              id: agent.id,
              name: agent.device_name ?? agent.agent_name,
              owner_name: agent.agent_name,
              phone: agent.telebirr_number,
              status: agent.status === 'active' ? 'Online' : 'Offline',
              last_seen_at: agent.last_seen_at,
            }
          : null,
        metrics: agent
          ? {
              status: agent.status === 'active' ? 'Online' : 'Offline',
              balance: agent.balance,
              commission_earned: commissionEarned,
              commission_rate: depositPct,
              pre_deposit: '0',
            }
          : null,
        capacity: {
          total: totalCapacity.toFixed(2),
          available: availableCapacity.toFixed(2),
          used_today: usedToday.toFixed(2),
          daily_limit: totalCapacity.toFixed(2),
        },
        revenue: {
          today: Number(revenue.today).toFixed(2),
          last_7d: Number(revenue.d7).toFixed(2),
          last_30d: Number(revenue.d30).toFixed(2),
        },
        swaps: swapsRes.rows.map((s) => ({
          id: s.id,
          amount: s.amount,
          source: s.source,
          status:
            s.status === 'added'
              ? 'Added'
              : s.status === 'pending'
                ? 'Pending'
                : 'Failed',
          note: s.note,
          date: s.created_at.toISOString().slice(0, 10),
          time: s.created_at.toISOString().slice(11, 16),
          created_at: s.created_at,
        })),
      };
    }
  );
}

/* -------------------------------------------------------------------------- */
/* Routes                                                                     */
/* -------------------------------------------------------------------------- */

const router = Router();

const wrap =
  <T,>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

router.get(
  '/me',
  wrap(async (req) => {
    const ctx = await loadOperatorFromRequest(req);
    return {
      operator: ctx.operator,
      session: {
        expires_at: ctx.tokenExpiresAt,
        token_tail: ctx.tokenTail,
      },
      assigned_agent_ids: ctx.assignedAgentIds,
    };
  })
);

router.get(
  '/dashboard',
  wrap(async (req) => buildDashboard(await loadOperatorFromRequest(req)))
);

router.post(
  '/sign-out',
  wrap(async (req) => {
    const ctx = await loadOperatorFromRequest(req);
    // Revoke the token so the magic link can't be reused after sign-out.
    await withTenantClient(
      { tenantId: null, bypassRls: true },
      async (client) => {
        await client.query(
          `UPDATE p2p_operator_access_tokens
              SET revoked_at = COALESCE(revoked_at, now())
            WHERE operator_id = $1 AND revoked_at IS NULL`,
          [ctx.operator.id]
        );
      }
    );
    return { ok: true };
  })
);

export default router;
