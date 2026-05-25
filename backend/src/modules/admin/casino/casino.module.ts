import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import { ConflictError, NotFoundError } from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import { emitToTenant } from '../../../realtime/socket';
import {
  getAdminScope,
  getIp,
  getUa,
  requireScopedTenantId,
} from '../admin-shared';

/* DTOs --------------------------------------------------------------------- */

const idParam = z.object({ id: z.string().uuid() });

const providerSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(60),
  logo_url: z.string().trim().url().optional(),
  is_active: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
});

const categorySchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(60),
  icon_url: z.string().trim().url().optional(),
  display_order: z.number().int().nonnegative().default(100),
  is_active: z.boolean().default(true),
});

const tagSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z.string().trim().min(1).max(60),
  color: z.string().trim().max(20).optional(),
});

const gameSchema = z.object({
  provider_id: z.string().uuid().optional(),
  category_id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(120),
  image_url: z.string().trim().url().optional(),
  rtp: z.number().min(0).max(100).optional(),
  volatility: z.enum(['low', 'medium', 'high', 'very_high']).optional(),
  is_active: z.boolean().default(true),
  is_featured: z.boolean().default(false),
  display_order: z.number().int().nonnegative().default(100),
  tag_ids: z.array(z.string().uuid()).default([]),
  config: z.record(z.unknown()).default({}),
});

const updateGameSchema = gameSchema.partial();

const toggleGameStatusSchema = z.object({
  is_active: z.boolean(),
});

const listGamesQuery = z.object({
  provider_id: z.string().uuid().optional(),
  category_id: z.string().uuid().optional(),
  is_active: z.coerce.boolean().optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
});

const engineConfigSchema = z.object({
  config: z.record(z.unknown()),
});

/* Helpers ------------------------------------------------------------------ */

function applyPatch<T extends Record<string, unknown>>(
  patch: Partial<T>,
  jsonbKeys: string[] = []
): { sets: string[]; values: unknown[]; nextIdx: number } {
  const sets: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (jsonbKeys.includes(k)) {
      sets.push(`${k} = $${i++}::jsonb`);
      values.push(JSON.stringify(v));
    } else {
      sets.push(`${k} = $${i++}`);
      values.push(v);
    }
  }
  return { sets, values, nextIdx: i };
}

/* Service ------------------------------------------------------------------ */

async function listProviders(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT id, tenant_id, name, slug, logo_url, is_active, config, created_at, updated_at
           FROM casino_providers
           ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
           ORDER BY name`,
        scope.tenantId ? [scope.tenantId] : []
      );
      return { items: r.rows };
    }
  );
}

async function createProvider(req: Request, body: z.infer<typeof providerSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      try {
        const r = await client.query(
          `INSERT INTO casino_providers (tenant_id, name, slug, logo_url, is_active, config)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb)
           RETURNING id, tenant_id, name, slug, logo_url, is_active, config, created_at, updated_at`,
          [tenantId, body.name, body.slug, body.logo_url ?? null, body.is_active, JSON.stringify(body.config)]
        );
        return r.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Provider slug already exists');
        }
        throw err;
      }
    }
  );
}

async function updateProvider(req: Request, id: string, body: Partial<z.infer<typeof providerSchema>>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const { sets, values, nextIdx } = applyPatch(body, ['config']);
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id);
      const r = await client.query(
        `UPDATE casino_providers SET ${sets.join(', ')} WHERE id = $${nextIdx}
         RETURNING id, tenant_id, name, slug, logo_url, is_active, config, created_at, updated_at`,
        values
      );
      if (!r.rows[0]) throw new NotFoundError('Provider not found');
      return r.rows[0];
    }
  );
}

async function deleteProvider(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(`DELETE FROM casino_providers WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows[0]) throw new NotFoundError('Provider not found');
      return { ok: true };
    }
  );
}

async function listCategories(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT id, tenant_id, name, slug, icon_url, display_order, is_active,
                created_at, updated_at
           FROM casino_categories
           ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
           ORDER BY display_order ASC, name`,
        scope.tenantId ? [scope.tenantId] : []
      );
      return { items: r.rows };
    }
  );
}

async function createCategory(req: Request, body: z.infer<typeof categorySchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      try {
        const r = await client.query(
          `INSERT INTO casino_categories (tenant_id, name, slug, icon_url, display_order, is_active)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, tenant_id, name, slug, icon_url, display_order, is_active,
                     created_at, updated_at`,
          [tenantId, body.name, body.slug, body.icon_url ?? null, body.display_order, body.is_active]
        );
        return r.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Category slug already exists');
        }
        throw err;
      }
    }
  );
}

async function updateCategory(
  req: Request,
  id: string,
  body: Partial<z.infer<typeof categorySchema>>
) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const { sets, values, nextIdx } = applyPatch(body);
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id);
      const r = await client.query(
        `UPDATE casino_categories SET ${sets.join(', ')} WHERE id = $${nextIdx}
         RETURNING id, tenant_id, name, slug, icon_url, display_order, is_active,
                   created_at, updated_at`,
        values
      );
      if (!r.rows[0]) throw new NotFoundError('Category not found');
      return r.rows[0];
    }
  );
}

async function deleteCategory(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(`DELETE FROM casino_categories WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows[0]) throw new NotFoundError('Category not found');
      return { ok: true };
    }
  );
}

async function listTags(req: Request) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `SELECT id, tenant_id, name, slug, color, created_at, updated_at
           FROM casino_tags
           ${scope.tenantId ? 'WHERE tenant_id = $1' : ''}
           ORDER BY name`,
        scope.tenantId ? [scope.tenantId] : []
      );
      return { items: r.rows };
    }
  );
}

async function createTag(req: Request, body: z.infer<typeof tagSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      try {
        const r = await client.query(
          `INSERT INTO casino_tags (tenant_id, name, slug, color)
           VALUES ($1,$2,$3,$4)
           RETURNING id, tenant_id, name, slug, color, created_at, updated_at`,
          [tenantId, body.name, body.slug, body.color ?? null]
        );
        return r.rows[0];
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Tag slug already exists');
        }
        throw err;
      }
    }
  );
}

async function updateTag(req: Request, id: string, body: Partial<z.infer<typeof tagSchema>>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const { sets, values, nextIdx } = applyPatch(body);
      if (!sets.length) throw new ConflictError('Nothing to update');
      values.push(id);
      const r = await client.query(
        `UPDATE casino_tags SET ${sets.join(', ')} WHERE id = $${nextIdx}
         RETURNING id, tenant_id, name, slug, color, created_at, updated_at`,
        values
      );
      if (!r.rows[0]) throw new NotFoundError('Tag not found');
      return r.rows[0];
    }
  );
}

async function deleteTag(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(`DELETE FROM casino_tags WHERE id = $1 RETURNING id`, [id]);
      if (!r.rows[0]) throw new NotFoundError('Tag not found');
      return { ok: true };
    }
  );
}

/* Games -------------------------------------------------------------------- */

/**
 * Map a casino_categories slug/name to the runtime `games.type` enum so the
 * user/mobile lobby can filter properly. Falls back to `'casino'` for
 * anything we don't recognise.
 */
function inferRuntimeType(categoryName: string | null, slug: string | null): string {
  const probe = `${categoryName ?? ''} ${slug ?? ''}`.toLowerCase();
  if (probe.includes('live')) return 'live_casino';
  if (probe.includes('virtual')) return 'virtual';
  if (probe.includes('crash') || probe.includes('aviator') || probe.includes('jet')) return 'crash';
  if (probe.includes('keno')) return 'keno';
  if (probe.includes('slot')) return 'slot';
  if (probe.includes('table')) return 'table';
  if (probe.includes('jackpot')) return 'jackpot';
  if (probe.includes('sport')) return 'sports';
  return 'casino';
}

interface CasinoGameSeed {
  id: string;
  tenant_id: string;
  provider_id: string | null;
  category_id: string | null;
  name: string;
  slug: string;
  image_url: string | null;
  rtp: string | null;
  is_active: boolean;
  config: Record<string, unknown>;
}

/**
 * Mirror a casino_games row into the runtime `games` table so the User
 * Panel + Mobile lobby + Game Engine see the same catalogue admin manages.
 * The mapping is one-way (admin → runtime) and idempotent: we look up the
 * existing runtime row by (tenant_id, casino_games.id stored in
 * `games.config.casino_game_id`) and INSERT or UPDATE accordingly.
 */
async function syncRuntimeGameRow(
  client: import('pg').PoolClient,
  game: CasinoGameSeed
): Promise<void> {
  // Resolve provider name + category name for the runtime row.
  const meta = await client.query<{
    provider_name: string | null;
    category_name: string | null;
    category_slug: string | null;
  }>(
    `SELECT
        (SELECT name FROM casino_providers  WHERE id = $1) AS provider_name,
        (SELECT name FROM casino_categories WHERE id = $2) AS category_name,
        (SELECT slug FROM casino_categories WHERE id = $2) AS category_slug`,
    [game.provider_id, game.category_id]
  );
  const providerName = meta.rows[0]?.provider_name ?? 'internal';
  const categoryName = meta.rows[0]?.category_name ?? null;
  const categorySlug = meta.rows[0]?.category_slug ?? null;
  const runtimeType = inferRuntimeType(categoryName, categorySlug ?? game.slug);

  const launchUrl =
    typeof game.config.launch_url === 'string'
      ? (game.config.launch_url as string)
      : typeof game.config.embed_url === 'string'
        ? (game.config.embed_url as string)
        : typeof game.config.iframe_url === 'string'
          ? (game.config.iframe_url as string)
          : null;
  const isIframe = Boolean(launchUrl);

  const runtimeConfig: Record<string, unknown> = {
    ...game.config,
    casino_game_id: game.id,
    image_url: game.image_url,
    slug: game.slug,
  };

  const existing = await client.query<{ id: string }>(
    `SELECT id FROM games
      WHERE tenant_id = $1
        AND (config->>'casino_game_id') = $2`,
    [game.tenant_id, game.id]
  );

  if (existing.rows[0]) {
    await client.query(
      `UPDATE games SET
          provider   = $2,
          name       = $3,
          type       = $4,
          config     = $5::jsonb,
          is_active  = $6,
          is_iframe  = $7,
          iframe_url = $8,
          rtp        = $9,
          status     = CASE WHEN $6 THEN 'available' ELSE 'disabled' END
        WHERE id = $1`,
      [
        existing.rows[0].id,
        providerName,
        game.name,
        runtimeType,
        JSON.stringify(runtimeConfig),
        game.is_active,
        isIframe,
        launchUrl,
        game.rtp,
      ]
    );
    return;
  }

  // INSERT — but the `games` table has a UNIQUE(tenant_id, provider, name)
  // constraint, so on conflict we just attach the casino_game_id.
  try {
    await client.query(
      `INSERT INTO games (
         tenant_id, provider, name, type, config, is_active, is_iframe,
         iframe_url, rtp, status
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)`,
      [
        game.tenant_id,
        providerName,
        game.name,
        runtimeType,
        JSON.stringify(runtimeConfig),
        game.is_active,
        isIframe,
        launchUrl,
        game.rtp,
        game.is_active ? 'available' : 'disabled',
      ]
    );
  } catch (err) {
    if ((err as { code?: string }).code !== '23505') throw err;
    // Existing same-name game owned by another flow: link it via config.
    await client.query(
      `UPDATE games SET
          config = jsonb_set(
            COALESCE(config, '{}'::jsonb),
            '{casino_game_id}',
            to_jsonb($3::text),
            true
          ),
          type       = COALESCE(type, $4),
          rtp        = COALESCE(rtp, $5),
          is_iframe  = is_iframe OR $6,
          iframe_url = COALESCE(iframe_url, $7),
          is_active  = $8,
          status     = CASE WHEN $8 THEN 'available' ELSE 'disabled' END
        WHERE tenant_id = $1 AND provider = $2 AND name = $9`,
      [
        game.tenant_id,
        providerName,
        game.id,
        runtimeType,
        game.rtp,
        isIframe,
        launchUrl,
        game.is_active,
        game.name,
      ]
    );
  }
}

/**
 * Soft-disable the runtime games row when the admin deletes the casino
 * catalog row. We don't delete because bets/sessions hold FKs into it.
 */
async function softDisableRuntimeGameRow(
  client: import('pg').PoolClient,
  tenantId: string,
  casinoGameId: string
): Promise<void> {
  await client.query(
    `UPDATE games
        SET is_active = false,
            status    = 'disabled'
      WHERE tenant_id = $1
        AND (config->>'casino_game_id') = $2`,
    [tenantId, casinoGameId]
  );
}

async function listGames(req: Request, q: z.infer<typeof listGamesQuery>) {
  const scope = getAdminScope(req);
  const offset = (q.page - 1) * q.limit;
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const filters: string[] = [];
      const values: unknown[] = [];
      let i = 1;
      if (scope.tenantId) {
        filters.push(`g.tenant_id = $${i++}`);
        values.push(scope.tenantId);
      }
      if (q.provider_id) {
        filters.push(`g.provider_id = $${i++}`);
        values.push(q.provider_id);
      }
      if (q.category_id) {
        filters.push(`g.category_id = $${i++}`);
        values.push(q.category_id);
      }
      if (q.is_active !== undefined) {
        filters.push(`g.is_active = $${i++}`);
        values.push(q.is_active);
      }
      if (q.search) {
        filters.push(`g.name ILIKE $${i++}`);
        values.push(`%${q.search}%`);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
      const total = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM casino_games g ${where}`,
        values
      );
      const rows = await client.query(
        `SELECT g.id, g.tenant_id, g.provider_id, g.category_id, g.name, g.slug,
                g.image_url, g.rtp, g.volatility, g.is_active, g.is_featured,
                g.display_order, g.config, g.created_at, g.updated_at,
                p.name AS provider_name, c.name AS category_name,
                COALESCE(t.tag_ids, '{}') AS tag_ids
           FROM casino_games g
           LEFT JOIN casino_providers p ON p.id = g.provider_id
           LEFT JOIN casino_categories c ON c.id = g.category_id
           LEFT JOIN LATERAL (
             SELECT array_agg(tag_id) AS tag_ids FROM casino_game_tags
              WHERE game_id = g.id
           ) t ON true
           ${where}
         ORDER BY g.display_order ASC, g.name
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

async function createGame(req: Request, body: z.infer<typeof gameSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      let r;
      try {
        r = await client.query(
          `INSERT INTO casino_games (
             tenant_id, provider_id, category_id, name, slug, image_url, rtp,
             volatility, is_active, is_featured, display_order, config
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
           RETURNING id, tenant_id, provider_id, category_id, name, slug,
                     image_url, rtp, volatility, is_active, is_featured,
                     display_order, config, created_at, updated_at`,
          [
            tenantId,
            body.provider_id ?? null,
            body.category_id ?? null,
            body.name,
            body.slug,
            body.image_url ?? null,
            body.rtp ?? null,
            body.volatility ?? null,
            body.is_active,
            body.is_featured,
            body.display_order,
            JSON.stringify(body.config),
          ]
        );
      } catch (err) {
        if ((err as { code?: string }).code === '23505') {
          throw new ConflictError('Game slug already exists');
        }
        throw err;
      }
      const game = r.rows[0];
      if (body.tag_ids.length) {
        const placeholders = body.tag_ids.map((_, idx) => `($1, $${idx + 3}, $2)`).join(', ');
        await client.query(
          `INSERT INTO casino_game_tags (game_id, tenant_id, tag_id)
           VALUES ${placeholders} ON CONFLICT DO NOTHING`,
          [game.id, tenantId, ...body.tag_ids]
        );
      }
      // Mirror into runtime `games` so the user/mobile lobby sees this game.
      await syncRuntimeGameRow(client, {
        id: game.id,
        tenant_id: tenantId,
        provider_id: game.provider_id,
        category_id: game.category_id,
        name: game.name,
        slug: game.slug,
        image_url: game.image_url,
        rtp: game.rtp,
        is_active: game.is_active,
        config: game.config ?? {},
      });

      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.casino.game.create',
          resource: 'casino_games',
          resourceId: game.id,
          payload: { after: game },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      emitToTenant(tenantId, 'CASINO_GAME_CREATED', { game });
      return { ...game, tag_ids: body.tag_ids };
    }
  );
}

async function updateGame(req: Request, id: string, body: z.infer<typeof updateGameSchema>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const { tag_ids, ...rest } = body;
      const { sets, values, nextIdx } = applyPatch(rest, ['config']);
      if (sets.length) {
        values.push(id);
        const r = await client.query(
          `UPDATE casino_games SET ${sets.join(', ')} WHERE id = $${nextIdx}
           RETURNING id, tenant_id, provider_id, category_id, name, slug,
                     image_url, rtp, volatility, is_active, is_featured,
                     display_order, config, created_at, updated_at`,
          values
        );
        if (!r.rows[0]) throw new NotFoundError('Game not found');
      }
      if (tag_ids !== undefined) {
        const game = await client.query<{ tenant_id: string }>(
          `SELECT tenant_id FROM casino_games WHERE id = $1`,
          [id]
        );
        if (!game.rows[0]) throw new NotFoundError('Game not found');
        await client.query(`DELETE FROM casino_game_tags WHERE game_id = $1`, [id]);
        if (tag_ids.length) {
          const placeholders = tag_ids.map((_, idx) => `($1, $${idx + 3}, $2)`).join(', ');
          await client.query(
            `INSERT INTO casino_game_tags (game_id, tenant_id, tag_id) VALUES ${placeholders}
             ON CONFLICT DO NOTHING`,
            [id, game.rows[0].tenant_id, ...tag_ids]
          );
        }
      }
      const final = await client.query(
        `SELECT g.id, g.tenant_id, g.provider_id, g.category_id, g.name, g.slug,
                g.image_url, g.rtp, g.volatility, g.is_active, g.is_featured,
                g.display_order, g.config, g.created_at, g.updated_at,
                COALESCE((SELECT array_agg(tag_id) FROM casino_game_tags WHERE game_id = g.id), '{}') AS tag_ids
           FROM casino_games g WHERE g.id = $1`,
        [id]
      );
      if (!final.rows[0]) throw new NotFoundError('Game not found');

      // Mirror updated row into runtime `games`.
      const updated = final.rows[0];
      await syncRuntimeGameRow(client, {
        id: updated.id,
        tenant_id: updated.tenant_id,
        provider_id: updated.provider_id,
        category_id: updated.category_id,
        name: updated.name,
        slug: updated.slug,
        image_url: updated.image_url,
        rtp: updated.rtp,
        is_active: updated.is_active,
        config: updated.config ?? {},
      });
      emitToTenant(updated.tenant_id, 'CASINO_GAME_UPDATED', { game: updated });

      return updated;
    }
  );
}

async function toggleGameStatus(req: Request, id: string, body: z.infer<typeof toggleGameStatusSchema>) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query(
        `UPDATE casino_games SET is_active = $1 WHERE id = $2
         RETURNING id, tenant_id, provider_id, category_id, name, slug,
                   image_url, rtp, volatility, is_active, is_featured,
                   display_order, config, created_at, updated_at`,
        [body.is_active, id]
      );
      const game = r.rows[0];
      if (!game) throw new NotFoundError('Game not found');

      await syncRuntimeGameRow(client, {
        id: game.id,
        tenant_id: game.tenant_id,
        provider_id: game.provider_id,
        category_id: game.category_id,
        name: game.name,
        slug: game.slug,
        image_url: game.image_url,
        rtp: game.rtp,
        is_active: game.is_active,
        config: game.config ?? {},
      });

      void tryAudit(
        {
          tenantId: game.tenant_id,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: body.is_active ? 'admin.casino.game.enable' : 'admin.casino.game.disable',
          resource: 'casino_games',
          resourceId: game.id,
          payload: { after: { is_active: game.is_active } },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      emitToTenant(game.tenant_id, 'CASINO_GAME_STATUS_CHANGED', {
        id: game.id,
        is_active: game.is_active,
      });
      return game;
    }
  );
}

async function deleteGame(req: Request, id: string) {
  const scope = getAdminScope(req);
  return withTenantClient(
    { tenantId: scope.tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const existing = await client.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM casino_games WHERE id = $1`,
        [id]
      );
      if (!existing.rows[0]) throw new NotFoundError('Game not found');
      // Soft-disable runtime row first (FKs from bets/sessions prevent hard
      // delete). Catalog row itself we hard-delete.
      await softDisableRuntimeGameRow(client, existing.rows[0].tenant_id, id);
      await client.query(`DELETE FROM casino_games WHERE id = $1`, [id]);
      return { ok: true };
    }
  );
}

/* Engine config (key/value persisted in `settings` table) ------------------- */

const CASINO_ENGINE_KEY = 'casino.engine.config';

async function getEngineConfig(req: Request) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const r = await client.query<{ value: Record<string, unknown> }>(
        `SELECT value FROM settings WHERE tenant_id = $1 AND key = $2`,
        [tenantId, CASINO_ENGINE_KEY]
      );
      return r.rows[0]?.value ?? {};
    }
  );
}

async function setEngineConfig(req: Request, body: z.infer<typeof engineConfigSchema>) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      await client.query(
        `INSERT INTO settings (tenant_id, key, value)
         VALUES ($1,$2,$3::jsonb)
         ON CONFLICT (tenant_id, key) DO UPDATE
           SET value = EXCLUDED.value, updated_at = now()`,
        [tenantId, CASINO_ENGINE_KEY, JSON.stringify(body.config)]
      );
      void tryAudit(
        {
          tenantId,
          actorId: scope.actorId,
          actorType: scope.actorType,
          action: 'admin.casino.engine.update',
          resource: 'settings',
          resourceId: CASINO_ENGINE_KEY,
          payload: { after: body.config },
          ip: getIp(req),
          userAgent: getUa(req),
          status: 'success',
        },
        { bypassRls: true }
      );
      return body.config;
    }
  );
}

/* Routes ------------------------------------------------------------------- */

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

router.get('/providers', wrap((req) => listProviders(req)));
router.post('/providers', wrapStatus(201, (req) => createProvider(req, providerSchema.parse(req.body))));
router.put(
  '/providers/:id',
  wrap((req) => updateProvider(req, idParam.parse(req.params).id, providerSchema.partial().parse(req.body)))
);
router.delete('/providers/:id', wrap((req) => deleteProvider(req, idParam.parse(req.params).id)));

router.get('/categories', wrap((req) => listCategories(req)));
router.post('/categories', wrapStatus(201, (req) => createCategory(req, categorySchema.parse(req.body))));
router.put(
  '/categories/:id',
  wrap((req) => updateCategory(req, idParam.parse(req.params).id, categorySchema.partial().parse(req.body)))
);
router.delete('/categories/:id', wrap((req) => deleteCategory(req, idParam.parse(req.params).id)));

router.get('/tags', wrap((req) => listTags(req)));
router.post('/tags', wrapStatus(201, (req) => createTag(req, tagSchema.parse(req.body))));
router.put(
  '/tags/:id',
  wrap((req) => updateTag(req, idParam.parse(req.params).id, tagSchema.partial().parse(req.body)))
);
router.delete('/tags/:id', wrap((req) => deleteTag(req, idParam.parse(req.params).id)));

router.get('/games', wrap((req) => listGames(req, listGamesQuery.parse(req.query))));
router.post('/games', wrapStatus(201, (req) => createGame(req, gameSchema.parse(req.body))));
router.put(
  '/games/:id',
  wrap((req) => updateGame(req, idParam.parse(req.params).id, updateGameSchema.parse(req.body)))
);
router.patch(
  '/games/:id/status',
  wrap((req) =>
    toggleGameStatus(
      req,
      idParam.parse(req.params).id,
      toggleGameStatusSchema.parse(req.body)
    )
  )
);
router.delete('/games/:id', wrap((req) => deleteGame(req, idParam.parse(req.params).id)));

// Engine config — spec uses `/engine/config`; we keep `/engine-config` as
// a backwards-compatible alias for clients that already use it.
router.get('/engine/config', wrap((req) => getEngineConfig(req)));
router.put(
  '/engine/config',
  wrap((req) => setEngineConfig(req, engineConfigSchema.parse(req.body)))
);
router.get('/engine-config', wrap((req) => getEngineConfig(req)));
router.put(
  '/engine-config',
  wrap((req) => setEngineConfig(req, engineConfigSchema.parse(req.body)))
);

export default router;
