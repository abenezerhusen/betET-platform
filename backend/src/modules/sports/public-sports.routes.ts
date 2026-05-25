import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError, NotFoundError } from '../../http/errors/http-error';
import { authenticateToken } from '../../middleware/authenticate';
import * as swagger from '../../swagger/registry';

const router = Router();

const listQuery = z.object({
  type: z.enum(['express']).optional(),
  sort: z.enum(['popularity']).optional(),
  // 'upcoming' is a spec alias for 'scheduled'. We accept both so the
  // user-panel can use whichever wording feels natural for the screen.
  status: z.enum(['scheduled', 'upcoming', 'live', 'completed']).optional(),
  is_featured: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === true || v === 'true')),
  sport: z.string().trim().min(1).max(64).optional(),
  league: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(30),
});

function requireTenantId(req: Request): string {
  const tenantId = req.tenant?.id ?? req.user?.tenantId ?? null;
  if (!tenantId) throw new BadRequestError('Tenant context required');
  return tenantId;
}

function mapStatus(status?: string): string | null {
  if (!status) return null;
  if (status === 'completed') return 'finished';
  if (status === 'upcoming') return 'scheduled';
  return status;
}

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

swagger.registerPath({
  method: 'get',
  path: '/api/sports/matches',
  summary: 'List sports matches for user panel',
  tags: ['Sports'],
  security: [],
  responses: { '200': { description: 'Matches list' } },
});

swagger.registerPath({
  method: 'get',
  path: '/api/sports/matches/{id}',
  summary: 'Get match details with markets',
  tags: ['Sports'],
  security: [],
  responses: { '200': { description: 'Match details' }, '404': { description: 'Match not found' } },
});

router.get(
  '/matches',
  wrap(async (req) => {
    const tenantId = requireTenantId(req);
    const q = listQuery.parse(req.query);
    const offset = (q.page - 1) * q.limit;
    const status = mapStatus(q.status);
    return withTenantClient({ tenantId }, async (client) => {
      const filters = ['ev.tenant_id = $1'];
      const values: unknown[] = [tenantId];
      let i = 2;
      if (status) {
        filters.push(`ev.status = $${i++}`);
        values.push(status);
      }
      if (q.type === 'express' || q.is_featured === true) {
        filters.push(`ev.is_featured = true`);
      } else if (q.is_featured === false) {
        filters.push(`ev.is_featured = false`);
      }
      if (q.sport) {
        filters.push(`lower(ev.sport) = lower($${i++})`);
        values.push(q.sport);
      }
      if (q.league) {
        filters.push(`lower(ev.league) = lower($${i++})`);
        values.push(q.league);
      }
      const where = `WHERE ${filters.join(' AND ')}`;
      const total = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM sports_events ev ${where}`,
        values
      );
      const orderBy = q.sort === 'popularity' ? 'total_bets DESC, ev.starts_at ASC' : 'ev.starts_at ASC';
      const rows = await client.query(
        `SELECT ev.id, ev.sport, ev.league, ev.home_team, ev.away_team, ev.starts_at, ev.status,
                COALESCE(ev.home_score, 0)::int AS home_score,
                COALESCE(ev.away_score, 0)::int AS away_score,
                COALESCE((ev.stats->>'minute')::int, 0) AS minute,
                ev.is_featured,
                COALESCE((SELECT COUNT(DISTINCT bl.bet_id)::int
                            FROM sports_markets m
                            JOIN sports_selections s ON s.market_id = m.id
                            JOIN sportsbook_bet_legs bl ON bl.selection_id = s.id
                           WHERE m.event_id = ev.id), 0) AS total_bets,
                COALESCE((SELECT s.odds_decimal::numeric
                            FROM sports_markets m
                            JOIN sports_selections s ON s.market_id = m.id
                           WHERE m.event_id = ev.id
                             AND (m.market_type ILIKE '1x2' OR m.label ILIKE '%match result%')
                             AND s.label ILIKE '1%'
                           ORDER BY s.created_at ASC LIMIT 1), 1.5) AS home_odds,
                COALESCE((SELECT s.odds_decimal::numeric
                            FROM sports_markets m
                            JOIN sports_selections s ON s.market_id = m.id
                           WHERE m.event_id = ev.id
                             AND (m.market_type ILIKE '1x2' OR m.label ILIKE '%match result%')
                             AND s.label ILIKE 'x%'
                           ORDER BY s.created_at ASC LIMIT 1), 3.0) AS draw_odds,
                COALESCE((SELECT s.odds_decimal::numeric
                            FROM sports_markets m
                            JOIN sports_selections s ON s.market_id = m.id
                           WHERE m.event_id = ev.id
                             AND (m.market_type ILIKE '1x2' OR m.label ILIKE '%match result%')
                             AND s.label ILIKE '2%'
                           ORDER BY s.created_at ASC LIMIT 1), 2.5) AS away_odds
           FROM sports_events ev
           ${where}
           ORDER BY ${orderBy}
           LIMIT $${i++} OFFSET $${i++}`,
        [...values, q.limit, offset]
      );
      return {
        items: rows.rows,
        total: Number(total.rows[0]?.count ?? 0),
        page: q.page,
        limit: q.limit,
      };
    });
  })
);

router.get(
  '/matches/:id',
  wrap(async (req) => {
    const tenantId = requireTenantId(req);
    const id = String(req.params.id ?? '').trim();
    return withTenantClient({ tenantId }, async (client) => {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
      let eventRes;
      if (isUuid) {
        eventRes = await client.query(
          `SELECT id, sport, league, home_team, away_team, starts_at, status,
                  COALESCE(home_score,0)::int AS home_score,
                  COALESCE(away_score,0)::int AS away_score,
                  COALESCE((stats->>'minute')::int, 0) AS minute
             FROM sports_events
            WHERE id = $1 AND tenant_id = $2
            LIMIT 1`,
          [id, tenantId]
        );
      } else {
        const slug = id.toLowerCase();
        const [homeRaw, awayRaw] = slug.split('-vs-');
        const home = (homeRaw ?? '').replace(/-/g, ' ');
        const away = (awayRaw ?? '').replace(/-/g, ' ');
        eventRes = await client.query(
          `SELECT id, sport, league, home_team, away_team, starts_at, status,
                  COALESCE(home_score,0)::int AS home_score,
                  COALESCE(away_score,0)::int AS away_score,
                  COALESCE((stats->>'minute')::int, 0) AS minute
             FROM sports_events
            WHERE tenant_id = $1
              AND lower(home_team) = lower($2)
              AND lower(away_team) = lower($3)
            ORDER BY starts_at DESC
            LIMIT 1`,
          [tenantId, home, away]
        );
      }
      const event = eventRes.rows[0];
      if (!event) throw new NotFoundError('Match not found');

      const marketsRes = await client.query(
        `SELECT m.id, m.market_type, m.label, m.status,
                COALESCE(
                  json_agg(
                    json_build_object(
                      'id', s.id,
                      'name', s.label,
                      'odds', s.odds_decimal
                    )
                    ORDER BY s.created_at
                  ) FILTER (WHERE s.id IS NOT NULL),
                  '[]'::json
                ) AS selections
           FROM sports_markets m
           LEFT JOIN sports_selections s ON s.market_id = m.id
          WHERE m.event_id = $1
          GROUP BY m.id, m.market_type, m.label, m.status
          ORDER BY m.created_at`,
        [event.id]
      );

      return {
        ...event,
        markets: marketsRes.rows.map((m: Record<string, unknown>) => ({
          id: m.id,
          name: m.label ?? m.market_type,
          selections: m.selections ?? [],
        })),
      };
    });
  })
);

/* ----------------------------------------------------------------------- */
/* Sports catalog (sidebar)                                                */
/* ----------------------------------------------------------------------- */

swagger.registerPath({
  method: 'get',
  path: '/api/sports/catalog',
  summary: 'Sports + leagues sidebar catalog with live match counts',
  tags: ['Sports'],
  security: [],
  responses: { '200': { description: 'Catalog tree' } },
});

/**
 * Builds the sidebar tree the user panel renders on the home/live pages:
 *
 *   [
 *     { sport: 'football', label: 'Football', live_count, upcoming_count,
 *       leagues: [ { name, live_count, upcoming_count } ] },
 *     ...
 *   ]
 *
 * Pure aggregate over `sports_events` — no joins to selections — so the
 * call is cheap and can be polled.
 */
router.get(
  '/catalog',
  wrap(async (req) => {
    const tenantId = requireTenantId(req);
    return withTenantClient({ tenantId }, async (client) => {
      const rows = await client.query<{
        sport: string;
        league: string | null;
        live: string;
        upcoming: string;
      }>(
        `SELECT lower(sport)  AS sport,
                league,
                SUM(CASE WHEN status = 'live'      THEN 1 ELSE 0 END)::text AS live,
                SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END)::text AS upcoming
           FROM sports_events
          WHERE tenant_id = $1
            AND status IN ('live','scheduled')
          GROUP BY lower(sport), league`,
        [tenantId]
      );

      const grouped = new Map<
        string,
        {
          sport: string;
          label: string;
          live_count: number;
          upcoming_count: number;
          leagues: {
            name: string;
            live_count: number;
            upcoming_count: number;
          }[];
        }
      >();

      for (const r of rows.rows) {
        const key = r.sport;
        if (!grouped.has(key)) {
          grouped.set(key, {
            sport: key,
            label: key.charAt(0).toUpperCase() + key.slice(1),
            live_count: 0,
            upcoming_count: 0,
            leagues: [],
          });
        }
        const node = grouped.get(key)!;
        const live = Number(r.live) || 0;
        const upcoming = Number(r.upcoming) || 0;
        node.live_count += live;
        node.upcoming_count += upcoming;
        if (r.league) {
          node.leagues.push({
            name: r.league,
            live_count: live,
            upcoming_count: upcoming,
          });
        }
      }

      return {
        sports: Array.from(grouped.values()).sort((a, b) =>
          a.sport.localeCompare(b.sport)
        ),
      };
    });
  })
);

/* ----------------------------------------------------------------------- */
/* Virtual sports (always-available simulated games)                       */
/* ----------------------------------------------------------------------- */

swagger.registerPath({
  method: 'get',
  path: '/api/sports/virtual/schedule',
  summary: 'Virtual sports schedule (simulated, always-available)',
  tags: ['Sports'],
  security: [],
  responses: { '200': { description: 'Schedule' } },
});

/**
 * Virtual sports are simulated 24/7. Until a real provider (e.g. BetRadar
 * Virtual Football League) is configured we generate a deterministic
 * rolling schedule so the screen always renders something playable. Each
 * round is 3 minutes; we surface the next eight rounds starting from now.
 *
 * The shape mirrors what a real provider would return so the user-panel
 * card can stay unchanged when we wire the live integration.
 */
router.get(
  '/virtual/schedule',
  wrap(async () => {
    const now = Date.now();
    const ROUND_MS = 3 * 60 * 1000;
    const sports = [
      { sport: 'virtual_football', label: 'Virtual Football' },
      { sport: 'virtual_horse_racing', label: 'Virtual Horse Racing' },
      { sport: 'virtual_dog_racing', label: 'Virtual Dog Racing' },
    ];
    const items: Array<{
      id: string;
      sport: string;
      label: string;
      round_no: number;
      starts_at: string;
      status: 'scheduled' | 'live';
      home_team: string;
      away_team: string;
      odds: { home: number; draw?: number; away: number };
    }> = [];
    for (const s of sports) {
      for (let n = 0; n < 8; n++) {
        const startMs = now + n * ROUND_MS - (now % ROUND_MS);
        const round = Math.floor(startMs / ROUND_MS) + n;
        items.push({
          id: `${s.sport}-${round}`,
          sport: s.sport,
          label: s.label,
          round_no: round,
          starts_at: new Date(startMs).toISOString(),
          status: n === 0 ? 'live' : 'scheduled',
          home_team: `Team A${(round % 12) + 1}`,
          away_team: `Team B${(round % 12) + 1}`,
          odds:
            s.sport === 'virtual_football'
              ? { home: 1.9, draw: 3.2, away: 2.4 }
              : { home: 1.7, away: 2.1 },
        });
      }
    }
    return { items, round_duration_seconds: 180 };
  })
);

swagger.registerPath({
  method: 'post',
  path: '/api/sports/virtual/bet',
  summary: 'Place a virtual sports bet',
  tags: ['Sports'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Bet placed' }, '401': { description: 'Unauthenticated' } },
});

const virtualBetSchema = z.object({
  round_id: z.string().trim().min(3).max(120),
  selection: z.enum(['home', 'draw', 'away']),
  stake: z.coerce.number().positive().max(1_000_000),
  odds: z.coerce.number().positive().max(1000),
});

/**
 * Virtual bet placement. We route through the existing wallet-debit
 * bookkeeping (`bets` + `transactions`) used for the casino games so the
 * user-panel Transaction History and Bets History endpoints pick the
 * record up without any changes. Settlement comes from the simulated
 * schedule once the round flips to `completed` — for now we mark the
 * bet `pending` so it appears in the user history immediately.
 */
router.post(
  '/virtual/bet',
  authenticateToken(),
  wrap(async (req) => {
    if (!req.user) {
      throw new BadRequestError('Authentication required', {
        reason: 'unauthenticated',
      });
    }
    const tenantId = req.user.tenantId;
    const body = virtualBetSchema.parse(req.body);
    const potentialWin = Math.round(body.stake * body.odds * 100) / 100;

    return withTenantClient({ tenantId }, async (client) => {
      const wallet = await client.query<{
        id: string;
        balance: string;
        currency: string;
      }>(
        `SELECT id, balance::text, currency
           FROM wallets
          WHERE user_id = $1 AND status = 'active'
          ORDER BY created_at ASC
          LIMIT 1`,
        [req.user!.id]
      );
      const w = wallet.rows[0];
      if (!w) {
        throw new BadRequestError('No active wallet', {
          reason: 'wallet_missing',
        });
      }
      const balance = Number(w.balance);
      if (balance < body.stake) {
        throw new BadRequestError('Insufficient balance', {
          reason: 'insufficient_funds',
          balance,
        });
      }

      await client.query('BEGIN');
      try {
        const afterBalance = Math.round((balance - body.stake) * 100) / 100;
        await client.query(
          `UPDATE wallets SET balance = $1, updated_at = now() WHERE id = $2`,
          [afterBalance, w.id]
        );
        const betRes = await client.query<{ id: string }>(
          `INSERT INTO bets
             (tenant_id, user_id, game_id, session_id, currency, stake,
              potential_win, status, selection, metadata, placed_at)
           VALUES ($1, $2, NULL, NULL, $3, $4, $5, 'pending', $6, $7, now())
           RETURNING id`,
          [
            tenantId,
            req.user!.id,
            w.currency,
            body.stake,
            potentialWin,
            JSON.stringify({ round_id: body.round_id, pick: body.selection }),
            JSON.stringify({ source: 'virtual_sports', odds: body.odds }),
          ]
        );
        await client.query(
          `INSERT INTO transactions
             (tenant_id, user_id, wallet_id, type, currency, amount,
              before_balance, after_balance, status, reference, metadata)
           VALUES ($1, $2, $3, 'bet', $4, $5, $6, $7, 'completed', $8, $9)`,
          [
            tenantId,
            req.user!.id,
            w.id,
            w.currency,
            -body.stake,
            balance,
            afterBalance,
            `virtual:${body.round_id}:${betRes.rows[0].id}`,
            JSON.stringify({
              source: 'virtual_sports',
              round_id: body.round_id,
              pick: body.selection,
              odds: body.odds,
            }),
          ]
        );
        await client.query('COMMIT');
        return {
          bet_id: betRes.rows[0].id,
          balance: afterBalance,
          potential_win: potentialWin,
          status: 'pending',
        };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  })
);

export default router;
