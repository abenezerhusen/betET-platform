import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import type { PoolClient } from 'pg';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { NotFoundError } from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { Events, emitToTenant, emitToUser } from '../../../realtime/socket';
import { resetUserStreak } from '../streaks/streaks.module';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

/* ========================================================================== */
/* DTOs                                                                        */
/* ========================================================================== */

const idParam = z.object({ id: z.string().uuid() });

/* Events ------------------------------------------------------------------- */
const listEventsQuery = z.object({
  sport: z.string().trim().min(1).optional(),
  status: z.enum(['scheduled', 'live', 'finished', 'postponed', 'cancelled']).optional(),
  is_featured: z.coerce.boolean().optional(),
  search: z.string().trim().min(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
});

const createEventSchema = z.object({
  sport: z.string().trim().min(1).max(80),
  league: z.string().trim().max(160).optional(),
  home_team: z.string().trim().min(1).max(160),
  away_team: z.string().trim().min(1).max(160),
  starts_at: z.coerce.date(),
  status: z
    .enum(['scheduled', 'live', 'finished', 'postponed', 'cancelled'])
    .default('scheduled'),
  metadata: z.record(z.unknown()).default({}),
  is_featured: z.boolean().default(false),
});

const updateEventSchema = createEventSchema.partial().extend({
  home_score: z.number().int().nonnegative().optional(),
  away_score: z.number().int().nonnegative().optional(),
  stats: z.record(z.unknown()).optional(),
});

/* Markets ------------------------------------------------------------------ */
const createMarketSchema = z.object({
  market_type: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(160),
  status: z.enum(['open', 'locked', 'settled', 'cancelled']).default('open'),
});

const updateMarketSchema = createMarketSchema.partial();

/* Selections --------------------------------------------------------------- */
const createSelectionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  odds_decimal: z.number().gt(1),
});

const updateSelectionSchema = createSelectionSchema
  .partial()
  .extend({ result: z.enum(['won', 'lost', 'void']).optional() });

/* Bets --------------------------------------------------------------------- */
const listBetsQuery = z.object({
  channel: z.enum(['offline', 'online', 'bet_for_me']).optional(),
  bet_type: z.enum(['single', 'combo', 'system', 'jackpot']).optional(),
  status: z
    .enum(['pending', 'won', 'lost', 'void', 'cashout', 'partial'])
    .optional(),
  user_id: z.string().uuid().optional(),
  cashier_id: z.string().uuid().optional(),
  jackpot_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

const settleBetSchema = z.object({
  status: z.enum(['won', 'lost', 'void', 'cashout', 'partial']),
  actual_payout: z.number().nonnegative().optional(),
});

/* ========================================================================== */
/* Repository                                                                  */
/* ========================================================================== */

interface EventRow {
  id: string;
  tenant_id: string;
  sport: string;
  league: string | null;
  home_team: string;
  away_team: string;
  starts_at: Date;
  status: string;
  home_score: number | null;
  away_score: number | null;
  metadata: Record<string, unknown>;
  stats: Record<string, unknown>;
  is_featured: boolean;
  created_at: Date;
  updated_at: Date;
}

const EVENT_COLS = `
  id, tenant_id, sport, league, home_team, away_team, starts_at, status,
  home_score, away_score, metadata, stats, is_featured, created_at, updated_at
`;

async function getEvent(client: PoolClient, id: string): Promise<EventRow | null> {
  const r = await client.query<EventRow>(
    `SELECT ${EVENT_COLS} FROM sports_events WHERE id = $1`,
    [id]
  );
  return r.rows[0] ?? null;
}

/* ========================================================================== */
/* Service                                                                    */
/* ========================================================================== */

async function listEvents(req: Request, q: z.infer<typeof listEventsQuery>) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (q.sport) {
        filters.push(`sport = $${i++}`);
        values.push(q.sport);
      }
      if (q.status) {
        filters.push(`status = $${i++}`);
        values.push(q.status);
      }
      if (q.is_featured !== undefined) {
        filters.push(`is_featured = $${i++}`);
        values.push(q.is_featured);
      }
      if (q.search) {
        filters.push(
          `(home_team ILIKE $${i} OR away_team ILIKE $${i} OR league ILIKE $${i})`
        );
        values.push(`%${q.search}%`);
        i++;
      }
      if (q.from) {
        filters.push(`starts_at >= $${i++}`);
        values.push(q.from);
      }
      if (q.to) {
        filters.push(`starts_at <= $${i++}`);
        values.push(q.to);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const total = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM sports_events ${where}`,
        values
      );
      const rows = await client.query<EventRow>(
        `SELECT ${EVENT_COLS} FROM sports_events ${where}
           ORDER BY starts_at DESC
           LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );
      return {
        items: rows.rows,
        total: Number(total.rows[0]?.count ?? 0),
        page: q.page,
        limit: q.limit,
      };
    }
  );
}

async function createEvent(req: Request, body: z.infer<typeof createEventSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query<EventRow>(
        `INSERT INTO sports_events (
           tenant_id, sport, league, home_team, away_team, starts_at, status,
           metadata, is_featured
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
         RETURNING ${EVENT_COLS}`,
        [
          tenantId,
          body.sport,
          body.league ?? null,
          body.home_team,
          body.away_team,
          body.starts_at,
          body.status,
          JSON.stringify(body.metadata),
          body.is_featured,
        ]
      );
      const row = r.rows[0];
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.sportsbook.event.create',
          resource: 'sports_events',
          resourceId: row.id,
          payload: { after: row },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      emitToTenant(tenantId, 'SPORTSBOOK_EVENT_CREATED', { event: row });
      return row;
    }
  );
}

async function updateEvent(
  req: Request,
  id: string,
  body: z.infer<typeof updateEventSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await getEvent(client, id);
      if (!before) throw new NotFoundError('Event not found');
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      const cast: Record<string, string> = { metadata: '::jsonb', stats: '::jsonb' };
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        sets.push(`${k} = $${i++}${cast[k] ?? ''}`);
        values.push(k === 'metadata' || k === 'stats' ? JSON.stringify(v) : v);
      }
      if (!sets.length) return before;
      values.push(id);
      const r = await client.query<EventRow>(
        `UPDATE sports_events SET ${sets.join(', ')}
           WHERE id = $${i}
           RETURNING ${EVENT_COLS}`,
        values
      );
      const after = r.rows[0];
      emitToTenant(before.tenant_id, 'SPORTSBOOK_EVENT_UPDATED', { event: after });
      return after;
    }
  );
}

async function deleteEvent(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `DELETE FROM sports_events WHERE id = $1 RETURNING tenant_id`,
        [id]
      );
      if (!r.rows[0]) throw new NotFoundError('Event not found');
      return { ok: true };
    }
  );
}

/* Markets + selections ----------------------------------------------------- */

async function listMarkets(req: Request, eventId: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const markets = await client.query(
        `SELECT id, tenant_id, event_id, market_type, label, status, settled_at,
                created_at, updated_at
           FROM sports_markets WHERE event_id = $1 ORDER BY created_at`,
        [eventId]
      );
      const sels = await client.query(
        `SELECT s.id, s.tenant_id, s.market_id, s.label, s.odds_decimal, s.result,
                s.created_at, s.updated_at
           FROM sports_selections s
           JOIN sports_markets m ON m.id = s.market_id
           WHERE m.event_id = $1`,
        [eventId]
      );
      const grouped = new Map<string, typeof sels.rows>();
      for (const sel of sels.rows) {
        const arr = grouped.get(sel.market_id) ?? [];
        arr.push(sel);
        grouped.set(sel.market_id, arr);
      }
      return markets.rows.map((m) => ({
        ...m,
        selections: grouped.get(m.id) ?? [],
      }));
    }
  );
}

async function createMarket(
  req: Request,
  eventId: string,
  body: z.infer<typeof createMarketSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const ev = await getEvent(client, eventId);
      if (!ev) throw new NotFoundError('Event not found');
      const r = await client.query(
        `INSERT INTO sports_markets (tenant_id, event_id, market_type, label, status)
         VALUES ($1,$2,$3,$4,$5)
         RETURNING id, tenant_id, event_id, market_type, label, status, settled_at,
                   created_at, updated_at`,
        [ev.tenant_id, eventId, body.market_type, body.label, body.status]
      );
      return r.rows[0];
    }
  );
}

async function updateMarket(
  req: Request,
  marketId: string,
  body: z.infer<typeof updateMarketSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        sets.push(`${k} = $${i++}`);
        values.push(v);
      }
      if (!sets.length) {
        const r = await client.query(
          `SELECT id, tenant_id, event_id, market_type, label, status, settled_at,
                  created_at, updated_at FROM sports_markets WHERE id = $1`,
          [marketId]
        );
        if (!r.rows[0]) throw new NotFoundError('Market not found');
        return r.rows[0];
      }
      values.push(marketId);
      const r = await client.query(
        `UPDATE sports_markets SET ${sets.join(', ')} WHERE id = $${i}
         RETURNING id, tenant_id, event_id, market_type, label, status, settled_at,
                   created_at, updated_at`,
        values
      );
      if (!r.rows[0]) throw new NotFoundError('Market not found');
      return r.rows[0];
    }
  );
}

async function createSelection(
  req: Request,
  marketId: string,
  body: z.infer<typeof createSelectionSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const m = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM sports_markets WHERE id = $1`,
        [marketId]
      );
      if (!m.rows[0]) throw new NotFoundError('Market not found');
      const r = await client.query(
        `INSERT INTO sports_selections (tenant_id, market_id, label, odds_decimal)
         VALUES ($1,$2,$3,$4)
         RETURNING id, tenant_id, market_id, label, odds_decimal, result, created_at, updated_at`,
        [m.rows[0].tenant_id, marketId, body.label, body.odds_decimal]
      );
      return r.rows[0];
    }
  );
}

async function updateSelection(
  req: Request,
  selectionId: string,
  body: z.infer<typeof updateSelectionSchema>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const sets: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      for (const [k, v] of Object.entries(body)) {
        if (v === undefined) continue;
        sets.push(`${k} = $${i++}`);
        values.push(v);
      }
      if (!sets.length) {
        const r = await client.query(
          `SELECT id, tenant_id, market_id, label, odds_decimal, result,
                  created_at, updated_at
             FROM sports_selections WHERE id = $1`,
          [selectionId]
        );
        if (!r.rows[0]) throw new NotFoundError('Selection not found');
        return r.rows[0];
      }
      values.push(selectionId);
      const r = await client.query(
        `UPDATE sports_selections SET ${sets.join(', ')} WHERE id = $${i}
         RETURNING id, tenant_id, market_id, label, odds_decimal, result, created_at, updated_at`,
        values
      );
      if (!r.rows[0]) throw new NotFoundError('Selection not found');
      const row = r.rows[0];

      // Section 18E — broadcast `odds:update` whenever the odds change so
      // every live betslip refreshes without a page reload. We also look
      // up the event_id so clients can filter by match.
      if (body.odds_decimal !== undefined) {
        const ev = await client.query<{ event_id: string }>(
          `SELECT m.event_id FROM sports_markets m WHERE m.id = $1`,
          [row.market_id]
        );
        const eventId = ev.rows[0]?.event_id ?? null;
        emitToTenant(row.tenant_id, Events.ODDS_UPDATE, {
          match_id: eventId,
          event_id: eventId,
          updates: [
            {
              selection_id: row.id,
              new_odds: Number(row.odds_decimal),
            },
          ],
        });
      }
      return row;
    }
  );
}

async function settleMarket(req: Request, marketId: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const m = await client.query<{ tenant_id: string; status: string }>(
        `UPDATE sports_markets SET status = 'settled', settled_at = now()
           WHERE id = $1
           RETURNING tenant_id, status`,
        [marketId]
      );
      if (!m.rows[0]) throw new NotFoundError('Market not found');

      // Settle bet legs that reference selections within this market.
      await client.query(
        `UPDATE sportsbook_bet_legs leg
            SET status = sel.result,
                settled_at = now()
           FROM sports_selections sel
          WHERE leg.selection_id = sel.id
            AND sel.market_id = $1
            AND leg.status = 'pending'
            AND sel.result IS NOT NULL`,
        [marketId]
      );

      // Settle parent bets where all legs have a final outcome.
      const settleBets = await client.query<{
        bet_id: string;
        tenant_id: string;
        user_id: string;
        new_status: string;
      }>(
        `WITH bet_legs AS (
            SELECT l.bet_id,
                   COUNT(*) AS total_legs,
                   COUNT(*) FILTER (WHERE l.status = 'pending') AS pending_legs,
                   BOOL_OR(l.status = 'lost') AS any_lost,
                   BOOL_AND(l.status IN ('won','void')) AS all_won_or_void,
                   MIN(l.status) FILTER (WHERE l.status NOT IN ('won','void')) AS first_other_status
              FROM sportsbook_bet_legs l
             WHERE l.bet_id IN (
               SELECT DISTINCT bet_id FROM sportsbook_bet_legs
                 WHERE selection_id IN (
                   SELECT id FROM sports_selections WHERE market_id = $1
                 )
             )
             GROUP BY l.bet_id
          )
          UPDATE sportsbook_bets b
             SET status = CASE
                            WHEN bl.any_lost THEN 'lost'
                            WHEN bl.all_won_or_void THEN 'won'
                            ELSE b.status
                          END,
                 settled_at = now(),
                 actual_payout = CASE
                                   WHEN bl.all_won_or_void
                                     THEN b.potential_payout
                                   ELSE 0
                                 END
            FROM bet_legs bl
           WHERE b.id = bl.bet_id
             AND bl.pending_legs = 0
             AND b.status = 'pending'
          RETURNING b.id AS bet_id, b.tenant_id, b.user_id, b.status AS new_status`,
        [marketId]
      );
      for (const row of settleBets.rows) {
        emitToUser(row.tenant_id, row.user_id, 'BET_SETTLED', {
          bet_id: row.bet_id,
          status: row.new_status,
        });
        // Spec § Streak Settings: reset-on-loss when globally enabled.
        if (row.new_status === 'lost') {
          void resetUserStreak({
            tenantId: row.tenant_id,
            userId: row.user_id,
            reason: 'loss',
          });
        }
      }
      return { ok: true, settled_bets: settleBets.rowCount };
    }
  );
}

/* Bets --------------------------------------------------------------------- */

async function listBets(req: Request, q: z.infer<typeof listBetsQuery>) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`b.tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (q.channel) {
        filters.push(`b.channel = $${i++}`);
        values.push(q.channel);
      }
      if (q.bet_type) {
        filters.push(`b.bet_type = $${i++}`);
        values.push(q.bet_type);
      }
      if (q.status) {
        filters.push(`b.status = $${i++}`);
        values.push(q.status);
      }
      if (q.user_id) {
        filters.push(`b.user_id = $${i++}`);
        values.push(q.user_id);
      }
      if (q.cashier_id) {
        filters.push(`b.cashier_id = $${i++}`);
        values.push(q.cashier_id);
      }
      if (q.jackpot_id) {
        filters.push(`b.jackpot_id = $${i++}`);
        values.push(q.jackpot_id);
      }
      if (q.from) {
        filters.push(`b.placed_at >= $${i++}`);
        values.push(q.from);
      }
      if (q.to) {
        filters.push(`b.placed_at <= $${i++}`);
        values.push(q.to);
      }
      if (q.search) {
        filters.push(`b.id::text ILIKE $${i++}`);
        values.push(`%${q.search}%`);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const allBetsSql = `
        WITH all_bets AS (
          SELECT
            sb.id,
            sb.tenant_id,
            sb.user_id,
            sb.cashier_id,
            sb.channel::text AS channel,
            sb.bet_type::text AS bet_type,
            sb.bet_for_user_phone,
            sb.stake::numeric AS stake,
            sb.currency,
            sb.potential_payout::numeric AS potential_payout,
            sb.actual_payout::numeric AS actual_payout,
            sb.status::text AS status,
            sb.jackpot_id,
            sb.metadata,
            sb.placed_at,
            sb.settled_at,
            sb.created_at,
            sb.updated_at
          FROM sportsbook_bets sb
          UNION ALL
          SELECT
            ub.id,
            ub.tenant_id,
            ub.user_id,
            NULL::uuid AS cashier_id,
            'online'::text AS channel,
            COALESCE(NULLIF(ub.metadata->>'bet_type', ''), 'single')::text AS bet_type,
            NULL::text AS bet_for_user_phone,
            ub.stake::numeric AS stake,
            ub.currency,
            ub.potential_win::numeric AS potential_payout,
            ub.payout::numeric AS actual_payout,
            ub.status::text AS status,
            NULL::uuid AS jackpot_id,
            ub.metadata,
            ub.placed_at,
            ub.settled_at,
            ub.created_at,
            ub.created_at AS updated_at
          FROM bets ub
        )
      `;
      const total = await client.query<{ count: string }>(
        `${allBetsSql}
         SELECT COUNT(*)::text AS count FROM all_bets b ${where}`,
        values
      );
      const rows = await client.query(
        `${allBetsSql}
         SELECT b.id, b.tenant_id, b.user_id, b.cashier_id, b.channel, b.bet_type,
                b.bet_for_user_phone, b.stake, b.currency, b.potential_payout,
                b.actual_payout, b.status, b.jackpot_id, b.metadata, b.placed_at,
                b.settled_at, b.created_at, b.updated_at,
                u.email AS user_email, u.phone AS user_phone
           FROM all_bets b
           LEFT JOIN users u ON u.id = b.user_id
           ${where}
         ORDER BY b.placed_at DESC
         LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );
      return {
        items: rows.rows,
        total: Number(total.rows[0]?.count ?? 0),
        page: q.page,
        limit: q.limit,
      };
    }
  );
}

async function getBet(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const bet = await client.query(
        `SELECT b.*, u.email AS user_email, u.phone AS user_phone
           FROM sportsbook_bets b LEFT JOIN users u ON u.id = b.user_id
           WHERE b.id = $1`,
        [id]
      );
      if (!bet.rows[0]) {
        const userBet = await client.query(
          `SELECT b.id, b.tenant_id, b.user_id,
                  NULL::uuid AS cashier_id,
                  'online'::text AS channel,
                  COALESCE(NULLIF(b.metadata->>'bet_type',''), 'single')::text AS bet_type,
                  NULL::text AS bet_for_user_phone,
                  b.stake::numeric AS stake,
                  b.currency,
                  b.potential_win::numeric AS potential_payout,
                  b.payout::numeric AS actual_payout,
                  b.status::text AS status,
                  NULL::uuid AS jackpot_id,
                  b.metadata,
                  b.placed_at,
                  b.settled_at,
                  b.created_at,
                  b.created_at AS updated_at,
                  u.email AS user_email,
                  u.phone AS user_phone
             FROM bets b
             LEFT JOIN users u ON u.id = b.user_id
            WHERE b.id = $1`,
          [id]
        );
        if (!userBet.rows[0]) throw new NotFoundError('Bet not found');
        return { ...userBet.rows[0], legs: [] };
      }
      const legs = await client.query(
        `SELECT l.id, l.bet_id, l.selection_id, l.odds_at_placement, l.status,
                l.settled_at, l.created_at,
                sel.label AS selection_label, sel.odds_decimal AS current_odds,
                sel.result, m.market_type, m.label AS market_label, m.event_id,
                ev.home_team, ev.away_team, ev.sport
           FROM sportsbook_bet_legs l
           LEFT JOIN sports_selections sel ON sel.id = l.selection_id
           LEFT JOIN sports_markets m ON m.id = sel.market_id
           LEFT JOIN sports_events ev ON ev.id = m.event_id
           WHERE l.bet_id = $1
           ORDER BY l.created_at`,
        [id]
      );
      return { ...bet.rows[0], legs: legs.rows };
    }
  );
}

async function settleBet(req: Request, id: string, body: z.infer<typeof settleBetSchema>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `UPDATE sportsbook_bets SET status = $1, actual_payout = COALESCE($2, actual_payout),
            settled_at = now()
           WHERE id = $3
           RETURNING id, tenant_id, user_id, status, actual_payout`,
        [body.status, body.actual_payout ?? null, id]
      );
      let row = r.rows[0] ?? null;
      let resourceName = 'sportsbook_bets';
      if (!row) {
        const userBetUpdate = await client.query(
          `UPDATE bets
              SET status = $1,
                  payout = CASE
                             WHEN $2::numeric IS NULL THEN payout
                             ELSE $2::numeric
                           END,
                  settled_at = now()
            WHERE id = $3
            RETURNING id, tenant_id, user_id, status, payout AS actual_payout`,
          [body.status, body.actual_payout ?? null, id]
        );
        row = userBetUpdate.rows[0] ?? null;
        resourceName = 'bets';
      }
      if (!row) throw new NotFoundError('Bet not found');
      void tryAudit(
        {
          tenantId: row.tenant_id,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.sportsbook.bet.settle',
          resource: resourceName,
          resourceId: id,
          payload: { after: row },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      emitToUser(row.tenant_id, row.user_id, 'BET_SETTLED', {
        bet_id: id,
        status: row.status,
        actual_payout: row.actual_payout,
      });
      return row;
    }
  );
}

async function voidBet(req: Request, id: string) {
  return settleBet(req, id, { status: 'void', actual_payout: 0 });
}

/* ========================================================================== */
/* Routes                                                                      */
/* ========================================================================== */

const router = Router();

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

/* Events */
router.get('/events', wrap((req) => listEvents(req, listEventsQuery.parse(req.query))));
router.post(
  '/events',
  wrapStatus(201, (req) => createEvent(req, createEventSchema.parse(req.body)))
);
router.get(
  '/events/:id',
  wrap(async (req) => {
    const { id } = idParam.parse(req.params);
    return withTenantClient(
      {
        tenantId: getAdminScope(req).tenantId,
        bypassRls: getAdminScope(req).bypassRls,
      },
      async (client) => {
        const ev = await getEvent(client, id);
        if (!ev) throw new NotFoundError('Event not found');
        return ev;
      }
    );
  })
);
router.put(
  '/events/:id',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return updateEvent(req, id, updateEventSchema.parse(req.body));
  })
);
router.delete(
  '/events/:id',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return deleteEvent(req, id);
  })
);

/* Markets & selections */
router.get(
  '/events/:id/markets',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return listMarkets(req, id);
  })
);
router.post(
  '/events/:id/markets',
  wrapStatus(201, (req) => {
    const { id } = idParam.parse(req.params);
    return createMarket(req, id, createMarketSchema.parse(req.body));
  })
);
router.put(
  '/markets/:id',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return updateMarket(req, id, updateMarketSchema.parse(req.body));
  })
);
router.post(
  '/markets/:id/settle',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return settleMarket(req, id);
  })
);
router.post(
  '/markets/:id/selections',
  wrapStatus(201, (req) => {
    const { id } = idParam.parse(req.params);
    return createSelection(req, id, createSelectionSchema.parse(req.body));
  })
);
router.put(
  '/selections/:id',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return updateSelection(req, id, updateSelectionSchema.parse(req.body));
  })
);

/* Bets */
router.get('/bets', wrap((req) => listBets(req, listBetsQuery.parse(req.query))));
router.get(
  '/bets/:id',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return getBet(req, id);
  })
);
router.post(
  '/bets/:id/settle',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return settleBet(req, id, settleBetSchema.parse(req.body));
  })
);
router.post(
  '/bets/:id/void',
  wrap((req) => {
    const { id } = idParam.parse(req.params);
    return voidBet(req, id);
  })
);

export default router;
