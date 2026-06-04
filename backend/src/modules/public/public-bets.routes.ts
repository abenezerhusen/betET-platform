/**
 * Section 16 Flow B — Walk-in / shop offline bet reservation.
 *
 *   POST /api/public/bets/reserve-offline
 *
 * Used by the user panel's "Place Bet" button when the slip is being
 * built on behalf of a walk-in player (no logged-in account). The
 * cashier launches the user panel in a new tab via "Launch Fixtures",
 * builds the slip, gets a coupon code, brings it back to the cashier
 * panel and types it into "Sell Ticket".
 *
 * Differences from /api/bets/place:
 *   - No auth required (the cashier panel is the implicit gatekeeper).
 *   - No wallet debit. The stake is collected as cash when the cashier
 *     runs `/api/cashier/tickets/{code}/sell`.
 *   - Stored under a per-tenant `walkin@playcore.local` placeholder user
 *     so RLS still applies and the bets table FK stays valid.
 *   - status='pending', channel='offline'. metadata.branch_pay=true so
 *     downstream code (settlement, reports) can distinguish these from
 *     real online bets if needed.
 *
 * Returns the auto-generated SBK-XXXXXXXX coupon code; the cashier's
 * `loadTicket` already accepts that format and resolves the bet.
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError } from '../../http/errors/http-error';
import {
  isWithinOperationHours,
  loadGeneralConfig,
} from '../admin/settings/general-config';
import { loadBettingConfig } from '../bets/betting-config';
import * as swagger from '../../swagger/registry';

const router = Router();

const WALKIN_EMAIL = 'walkin@playcore.local';

function requireTenantId(req: Request): string {
  const tenantId = req.tenant?.id ?? null;
  if (!tenantId) throw new BadRequestError('Tenant context required');
  return tenantId;
}

/**
 * A leg of the slip. The caller can either:
 *   a) Provide the real `selection_id` (preferred — fast lookup), OR
 *   b) Provide a `selection_hint` with team names + market label + pick
 *      label so the backend can resolve the selection itself. This is
 *      what lets the user panel reserve real branch-pay tickets even
 *      when an old client bundle didn't thread the IDs through.
 */
const selectionHintSchema = z.object({
  home_team: z.string().trim().min(1),
  away_team: z.string().trim().min(1),
  /** "Match Result", "1x2", "Both Teams to Score", etc. */
  market_label: z.string().trim().min(1).optional(),
  /** "Home" | "Draw" | "Away" | "1" | "X" | "2" — case insensitive */
  selection_label: z.string().trim().min(1),
  /** Optional disambiguator when several events share team names */
  starts_at: z.string().datetime().optional(),
});

const legSchema = z
  .object({
    selection_id: z.string().uuid().optional(),
    selection_hint: selectionHintSchema.optional(),
    odds_seen: z.number().positive().optional(),
  })
  .refine((v) => Boolean(v.selection_id || v.selection_hint), {
    message: 'selection_id or selection_hint required',
  });

const reserveSchema = z.object({
  stake: z.coerce.number().positive().max(10_000_000),
  bet_type: z.enum(['single', 'combo', 'system']).default('combo'),
  currency: z.string().trim().min(2).max(8).default('ETB'),
  selections: z.array(legSchema).min(1).max(50),
  metadata: z.record(z.unknown()).default({}),
});

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcTotalOdds(odds: number[]): number {
  if (!odds.length) return 1;
  return odds.reduce((acc, o) => acc * o, 1);
}

interface ResolvedSelection {
  selection_id: string;
  market_id: string;
  event_id: string;
  event_status: string;
  event_starts_at: Date;
  selection_odds: number;
  selection_result: 'won' | 'lost' | 'void' | null;
  market_status: 'open' | 'locked' | 'settled' | 'cancelled';
}

/**
 * Resolve a single leg-hint to a `selection_id`. We tolerate either the
 * Home/Draw/Away or 1/X/2 label conventions on both the seed and the
 * caller. Falls back to ordinal position (1=home, 2=away) so the lookup
 * stays correct even on imported league data with non-standard labels.
 */
async function resolveSelectionIdFromHint(
  client: PoolClient,
  tenantId: string,
  hint: z.infer<typeof selectionHintSchema>
): Promise<string | null> {
  const pickRaw = hint.selection_label.trim().toLowerCase();
  // Normalise 1/X/2 → home/draw/away
  const pick =
    pickRaw === '1' || pickRaw === 'home'
      ? 'home'
      : pickRaw === 'x' || pickRaw === 'draw'
        ? 'draw'
        : pickRaw === '2' || pickRaw === 'away'
          ? 'away'
          : pickRaw; // any other custom market label is matched directly

  // Find the event by team names (case insensitive, ignore-trim).
  const eventRow = await client.query<{ id: string }>(
    `SELECT id
       FROM sports_events
      WHERE tenant_id = $1
        AND lower(home_team) = lower($2)
        AND lower(away_team) = lower($3)
        AND status NOT IN ('finished', 'cancelled')
      ORDER BY starts_at ASC
      LIMIT 1`,
    [tenantId, hint.home_team.trim(), hint.away_team.trim()]
  );
  if (!eventRow.rows[0]) return null;
  const eventId = eventRow.rows[0].id;

  // Find the 1x2 / Match Result market on that event. We accept any market
  // whose type contains '1x2' / 'match_result' or whose label contains
  // 'match result' so both seeded and imported feeds keep working.
  const marketRow = await client.query<{ id: string }>(
    `SELECT id
       FROM sports_markets
      WHERE tenant_id = $1
        AND event_id = $2
        AND status = 'open'
        AND (
          LOWER(market_type) LIKE '%1x2%'
          OR LOWER(market_type) LIKE '%match%result%'
          OR LOWER(market_type) = 'match_result'
          OR LOWER(label) LIKE '%match result%'
          OR LOWER(label) LIKE '%1x2%'
        )
      ORDER BY created_at ASC
      LIMIT 1`,
    [tenantId, eventId]
  );
  if (!marketRow.rows[0]) return null;
  const marketId = marketRow.rows[0].id;

  // Pick by label first (Home / Draw / Away or 1 / X / 2), then by ordinal
  // position if the label match misses (some imports use team names as
  // selection labels).
  const labelToOrdinal: Record<string, number> = {
    home: 1,
    draw: 2,
    away: 3,
  };

  const byLabel = await client.query<{ id: string }>(
    `SELECT id
       FROM sports_selections
      WHERE tenant_id = $1
        AND market_id = $2
        AND (
          LOWER(label) = $3
          OR LOWER(label) = $4
          OR LOWER(label) LIKE $3 || '%'
        )
      LIMIT 1`,
    [
      tenantId,
      marketId,
      pick,
      // 1/X/2 mapping for seeds that store '1', 'X', '2' as labels
      pick === 'home' ? '1' : pick === 'draw' ? 'x' : pick === 'away' ? '2' : pick,
    ]
  );
  if (byLabel.rows[0]) return byLabel.rows[0].id;

  const ordinal = labelToOrdinal[pick];
  if (!ordinal) return null;

  // Final fallback: pick the Nth selection in the market (1-based) ordered
  // by created_at. Seeds insert Home → Draw → Away in that order.
  const byOrdinal = await client.query<{ id: string }>(
    `SELECT id
       FROM sports_selections
      WHERE tenant_id = $1
        AND market_id = $2
      ORDER BY created_at ASC
      OFFSET $3 LIMIT 1`,
    [tenantId, marketId, ordinal - 1]
  );
  return byOrdinal.rows[0]?.id ?? null;
}

/**
 * Lazily materialise a selection from a hint when it does not yet exist in
 * the catalog.
 *
 * The user panel renders a large catalog of sample fixtures (per-league
 * generated data) that are NOT seeded in the backend. To let players reserve
 * a real branch-pay ticket on any displayed match — the whole point of the
 * offline-reserve flow — we create the missing `sports_events` →
 * `sports_markets` → `sports_selections` rows on demand, keyed by the team
 * names so repeat bets on the same fixture reuse the same rows (no
 * duplicates). The picked selection takes the odds the player saw; the other
 * 1x2 outcomes get sensible placeholders.
 *
 * Scoped to this offline-reserve endpoint only.
 */
async function ensureSelectionFromHint(
  client: PoolClient,
  tenantId: string,
  hint: z.infer<typeof selectionHintSchema>,
  oddsSeen: number | undefined
): Promise<string | null> {
  const pickRaw = hint.selection_label.trim().toLowerCase();
  const pick =
    pickRaw === '1' || pickRaw === 'home'
      ? 'home'
      : pickRaw === 'x' || pickRaw === 'draw'
        ? 'draw'
        : pickRaw === '2' || pickRaw === 'away'
          ? 'away'
          : null;
  // Only the standard 1x2 outcomes are auto-creatable; anything else needs a
  // real seeded market.
  if (!pick) return null;

  const home = hint.home_team.trim();
  const away = hint.away_team.trim();

  // 1. Reuse an existing event for these teams (any non-cancelled status),
  //    else create one. Push kickoff into the future so the "match started"
  //    guard downstream doesn't immediately reject the slip.
  const startsAt =
    hint.starts_at && new Date(hint.starts_at).getTime() > Date.now() + 60_000
      ? new Date(hint.starts_at)
      : new Date(Date.now() + 2 * 60 * 60 * 1000);

  const existingEvent = await client.query<{ id: string }>(
    `SELECT id FROM sports_events
      WHERE tenant_id = $1
        AND lower(home_team) = lower($2)
        AND lower(away_team) = lower($3)
        AND status <> 'cancelled'
      ORDER BY starts_at DESC
      LIMIT 1`,
    [tenantId, home, away]
  );
  let eventId = existingEvent.rows[0]?.id ?? null;
  if (!eventId) {
    const created = await client.query<{ id: string }>(
      `INSERT INTO sports_events (tenant_id, sport, league, home_team, away_team, starts_at, status)
       VALUES ($1, 'football', $2, $3, $4, $5, 'scheduled')
       RETURNING id`,
      [tenantId, 'Mock League', home, away, startsAt.toISOString()]
    );
    eventId = created.rows[0].id;
  }

  // 2. Reuse / create the 1x2 market.
  const existingMarket = await client.query<{ id: string }>(
    `SELECT id FROM sports_markets
      WHERE tenant_id = $1 AND event_id = $2
        AND (LOWER(market_type) LIKE '%1x2%' OR LOWER(label) LIKE '%match result%')
      ORDER BY created_at ASC
      LIMIT 1`,
    [tenantId, eventId]
  );
  let marketId = existingMarket.rows[0]?.id ?? null;
  if (!marketId) {
    const created = await client.query<{ id: string }>(
      `INSERT INTO sports_markets (tenant_id, event_id, market_type, label, status)
       VALUES ($1, $2, '1x2', 'Full Time Result', 'open')
       RETURNING id`,
      [tenantId, eventId]
    );
    marketId = created.rows[0].id;
  }

  // 3. Ensure all three 1x2 selections exist; the picked one carries the
  //    player's seen odds.
  const labelFor: Record<string, string> = { home: 'Home', draw: 'Draw', away: 'Away' };
  const defaultOdds: Record<string, number> = { home: 2.0, draw: 3.2, away: 3.5 };
  const pickOdds = oddsSeen && oddsSeen > 1 ? oddsSeen : defaultOdds[pick];

  for (const outcome of ['home', 'draw', 'away'] as const) {
    const label = labelFor[outcome];
    const odds = outcome === pick ? pickOdds : defaultOdds[outcome];
    await client.query(
      `INSERT INTO sports_selections (tenant_id, market_id, label, odds_decimal)
       SELECT $1, $2, $3, $4
        WHERE NOT EXISTS (
          SELECT 1 FROM sports_selections
           WHERE tenant_id = $1 AND market_id = $2 AND lower(label) = lower($3)
        )`,
      [tenantId, marketId, label, odds]
    );
  }

  const sel = await client.query<{ id: string }>(
    `SELECT id FROM sports_selections
      WHERE tenant_id = $1 AND market_id = $2 AND lower(label) = lower($3)
      LIMIT 1`,
    [tenantId, marketId, labelFor[pick]]
  );
  return sel.rows[0]?.id ?? null;
}

async function resolveSelections(
  client: PoolClient,
  tenantId: string,
  selectionIds: string[]
): Promise<ResolvedSelection[]> {
  const r = await client.query<ResolvedSelection>(
    `SELECT s.id   AS selection_id,
            s.market_id,
            m.event_id,
            ev.status                    AS event_status,
            ev.starts_at                 AS event_starts_at,
            s.odds_decimal::float        AS selection_odds,
            s.result                     AS selection_result,
            m.status                     AS market_status
       FROM sports_selections s
       JOIN sports_markets m  ON m.id = s.market_id
       JOIN sports_events ev  ON ev.id = m.event_id
      WHERE s.tenant_id = $1
        AND s.id = ANY($2::uuid[])`,
    [tenantId, selectionIds]
  );
  return r.rows;
}

/**
 * Resolve (or lazily create) the per-tenant walk-in placeholder user.
 * sportsbook_bets.user_id is NOT NULL with FK → users(id), so every
 * branch-pay reservation needs a real row. One placeholder per tenant
 * keeps RLS happy and lets cashier reports group all walk-in tickets.
 */
async function ensureWalkinUserId(
  client: PoolClient,
  tenantId: string
): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM users
      WHERE tenant_id = $1 AND email = $2::citext
      LIMIT 1`,
    [tenantId, WALKIN_EMAIL]
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO users
       (tenant_id, email, phone, password_hash, role, status, kyc_status, metadata)
     VALUES ($1, $2::citext, NULL, '!walkin', 'user', 'active', 'verified',
             $3::jsonb)
     RETURNING id`,
    [
      tenantId,
      WALKIN_EMAIL,
      JSON.stringify({
        full_name: 'Walk-in Player',
        placeholder: true,
        purpose: 'branch_pay_pending',
      }),
    ]
  );
  return inserted.rows[0].id;
}

swagger.registerPath({
  method: 'post',
  path: '/api/public/bets/reserve-offline',
  summary:
    'Reserve a sportsbook slip for a walk-in player (Section 16 Flow B)',
  tags: ['Public'],
  responses: {
    '200': { description: 'Reservation created' },
    '400': { description: 'Validation error' },
  },
});

router.post(
  '/reserve-offline',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const tenantId = requireTenantId(req);
      const body = reserveSchema.parse(req.body);

      const out = await withTenantClient(
        { tenantId },
        async (client) => {
          const cfg = await loadBettingConfig(client, tenantId);

          const general = await loadGeneralConfig(client, tenantId);
          if (
            general.operation_hours_enforce_bets &&
            !isWithinOperationHours(general)
          ) {
            throw new BadRequestError('Platform is currently closed', {
              reason: 'outside_operation_hours',
            });
          }

          // Resolve any hint-only legs to real selection IDs first. If
          // resolution fails for a leg we reject the slip with a clear
          // reason so the caller can show the user which pick is the
          // problem (vs. silently dropping it).
          const ids: string[] = [];
          const seen = new Set<string>();
          for (let i = 0; i < body.selections.length; i++) {
            const sel = body.selections[i];
            let id = sel.selection_id ?? null;
            if (!id && sel.selection_hint) {
              id = await resolveSelectionIdFromHint(
                client,
                tenantId,
                sel.selection_hint
              );
              // Not in the seeded catalog (e.g. a generated sample fixture in
              // the user panel) — materialise it on demand so any displayed
              // match is bettable, then proceed with the new selection id.
              if (!id) {
                id = await ensureSelectionFromHint(
                  client,
                  tenantId,
                  sel.selection_hint,
                  sel.odds_seen
                );
              }
              if (!id) {
                throw new BadRequestError(
                  `Could not resolve pick #${i + 1} (${sel.selection_hint.home_team} v ${sel.selection_hint.away_team})`,
                  {
                    reason: 'hint_unresolved',
                    leg_index: i,
                    hint: sel.selection_hint,
                  }
                );
              }
            }
            if (!id) {
              throw new BadRequestError(
                `Pick #${i + 1} missing selection_id and selection_hint`,
                { reason: 'leg_unspecified', leg_index: i }
              );
            }
            if (seen.has(id)) {
              throw new BadRequestError('Duplicate selection in slip', {
                reason: 'duplicate_leg',
                selection_id: id,
              });
            }
            seen.add(id);
            ids.push(id);
          }

          const resolved = await resolveSelections(client, tenantId, ids);
          if (resolved.length !== ids.length) {
            throw new BadRequestError('One or more selections not found', {
              reason: 'selection_not_found',
            });
          }

          const seenEvents = new Set<string>();
          for (const r of resolved) {
            seenEvents.add(r.event_id);
            if (r.selection_result !== null) {
              throw new BadRequestError('A selection has already settled', {
                reason: 'selection_settled',
                selection_id: r.selection_id,
              });
            }
            if (r.market_status !== 'open') {
              throw new BadRequestError('A market is closed for betting', {
                reason: 'market_closed',
                market_id: r.market_id,
              });
            }
            if (
              r.event_status === 'finished' ||
              r.event_status === 'cancelled'
            ) {
              throw new BadRequestError('A match has already concluded', {
                reason: 'match_finished',
                event_id: r.event_id,
              });
            }
            if (
              r.event_status === 'scheduled' &&
              new Date(r.event_starts_at).getTime() <= Date.now()
            ) {
              throw new BadRequestError('Match has already started', {
                reason: 'match_started',
                event_id: r.event_id,
              });
            }
            if (r.selection_odds < cfg.slip.min_individual_odd) {
              throw new BadRequestError(
                `Odds ${r.selection_odds.toFixed(2)} below minimum ${cfg.slip.min_individual_odd}`,
                { reason: 'odds_too_low', selection_id: r.selection_id }
              );
            }
          }

          if (resolved.length > cfg.slip.max_legs) {
            throw new BadRequestError(
              `Too many selections (max ${cfg.slip.max_legs})`,
              { reason: 'too_many_legs', max: cfg.slip.max_legs }
            );
          }
          if (body.bet_type === 'combo' && resolved.length < 2) {
            throw new BadRequestError(
              'A combo bet must have at least 2 selections',
              { reason: 'combo_needs_two' }
            );
          }
          if (
            resolved.length !== seenEvents.size &&
            body.bet_type === 'combo'
          ) {
            throw new BadRequestError(
              'Cannot combine multiple selections from the same match',
              { reason: 'duplicate_event' }
            );
          }

          const oddsList = resolved.map((r) => r.selection_odds);
          const totalOdds = calcTotalOdds(oddsList);
          if (totalOdds > cfg.slip.max_total_odds) {
            throw new BadRequestError(
              `Total odds ${totalOdds.toFixed(2)} exceed maximum ${cfg.slip.max_total_odds}`,
              { reason: 'total_odds_too_high', max: cfg.slip.max_total_odds }
            );
          }
          // The branch-pay flow can accept a lower floor than the online
          // path because the cashier collects cash at the till — but we
          // still respect the configured online_min_stake as a safety
          // net so the cashier panel sees the same minimum the user
          // panel enforced.
          const stake = body.stake;
          if (stake < cfg.slip.online_min_stake) {
            throw new BadRequestError(
              `Stake ${stake} below minimum ${cfg.slip.online_min_stake}`,
              { reason: 'stake_below_min', min: cfg.slip.online_min_stake }
            );
          }
          const potentialPayout = round2(stake * totalOdds);
          if (potentialPayout > cfg.slip.max_payout_per_slip) {
            throw new BadRequestError(
              `Potential payout ${potentialPayout} exceeds slip cap ${cfg.slip.max_payout_per_slip}`,
              { reason: 'payout_exceeds_cap' }
            );
          }

          // Pull descriptive labels for the resolved legs (event +
          // market + selection) so the cashier print receipt has the
          // picks. Stored under metadata.selections; `presentTicket()`
          // surfaces it directly on the lookup response.
          const legDetails = await client.query<{
            selection_id: string;
            selection_label: string;
            selection_odds: number;
            market_label: string;
            market_type: string;
            home_team: string;
            away_team: string;
            league: string | null;
            starts_at: Date;
          }>(
            `SELECT s.id                  AS selection_id,
                    s.label               AS selection_label,
                    s.odds_decimal::float AS selection_odds,
                    m.label               AS market_label,
                    m.market_type         AS market_type,
                    ev.home_team,
                    ev.away_team,
                    ev.league,
                    ev.starts_at
               FROM sports_selections s
               JOIN sports_markets m ON m.id = s.market_id
               JOIN sports_events ev ON ev.id = m.event_id
              WHERE s.tenant_id = $1
                AND s.id = ANY($2::uuid[])`,
            [tenantId, ids]
          );
          const legByMatch = new Map(
            legDetails.rows.map((r) => [r.selection_id, r])
          );
          const selectionsForReceipt = ids.map((selId) => {
            const d = legByMatch.get(selId);
            if (!d) return { selection_id: selId };
            return {
              selection_id: selId,
              match: `${d.home_team} v ${d.away_team}`,
              home_team: d.home_team,
              away_team: d.away_team,
              league: d.league,
              market: d.market_label,
              market_type: d.market_type,
              selection: d.selection_label,
              odds: d.selection_odds,
              starts_at: d.starts_at.toISOString(),
            };
          });

          const walkinUserId = await ensureWalkinUserId(client, tenantId);
          const betType =
            resolved.length === 1 ? 'single' : body.bet_type;

          const inserted = await client.query<{
            id: string;
            coupon_code: string;
            ticket_code: string;
            placed_at: Date;
          }>(
            `INSERT INTO sportsbook_bets (
               tenant_id, user_id, channel, bet_type,
               stake, currency, total_odds, potential_payout, tax_amount,
               status, cashout_available, metadata
             ) VALUES (
               $1, $2, 'offline', $3,
               $4, $5, $6, $7, 0,
               'pending', false, $8::jsonb
             )
             RETURNING id, coupon_code, ticket_code, placed_at`,
            [
              tenantId,
              walkinUserId,
              betType,
              stake,
              body.currency,
              totalOdds,
              potentialPayout,
              JSON.stringify({
                ...(body.metadata ?? {}),
                placed_via: 'user_panel_offline',
                branch_pay: true,
                walk_in: true,
                picks_count: resolved.length,
                selections: selectionsForReceipt,
              }),
            ]
          );
          const betId = inserted.rows[0].id;

          for (const r of resolved) {
            await client.query(
              `INSERT INTO sportsbook_bet_legs
                 (tenant_id, bet_id, selection_id, odds_at_placement, status)
               VALUES ($1, $2, $3, $4, 'pending')`,
              [tenantId, betId, r.selection_id, r.selection_odds]
            );
          }

          return {
            bet_id: betId,
            coupon_code: inserted.rows[0].coupon_code,
            ticket_code: inserted.rows[0].ticket_code,
            stake,
            total_odds: totalOdds,
            potential_payout: potentialPayout,
            currency: body.currency,
            bet_type: betType,
            picks_count: resolved.length,
            placed_at: inserted.rows[0].placed_at.toISOString(),
            status: 'pending' as const,
            channel: 'offline' as const,
          };
        }
      );

      res.status(201).json(out);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
