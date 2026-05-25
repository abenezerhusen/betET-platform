import type { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import { withTenantClient } from '../infrastructure/db/tenant-client';
import { BadRequestError } from '../http/errors/http-error';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface SlugCacheEntry {
  id: string;
  expiresAt: number;
}
const slugCache = new Map<string, SlugCacheEntry>();
const SLUG_CACHE_TTL_MS = 60_000;

function getCachedSlug(slug: string): string | null {
  const entry = slugCache.get(slug);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    slugCache.delete(slug);
    return null;
  }
  return entry.id;
}

function setCachedSlug(slug: string, id: string): void {
  slugCache.set(slug, { id, expiresAt: Date.now() + SLUG_CACHE_TTL_MS });
}

async function resolveSlug(slug: string): Promise<string | null> {
  const cached = getCachedSlug(slug);
  if (cached) return cached;

  const id = await withTenantClient(
    { tenantId: null, bypassRls: true },
    async (client) => {
      const r = await client.query<{ id: string }>(
        `SELECT id FROM tenants
         WHERE slug = $1::citext AND status = 'active'
         LIMIT 1`,
        [slug]
      );
      return r.rows[0]?.id ?? null;
    }
  );

  if (id) setCachedSlug(slug, id);
  return id;
}

function subdomainFromHost(host: string): string | null {
  const base = env.TENANT_DOMAIN_BASE;
  if (!base) return null;
  const lower = host.toLowerCase();
  if (!lower.endsWith(base)) return null;
  const sub = lower.slice(0, lower.length - base.length).replace(/\.$/, '');
  if (!sub || sub === 'www' || sub === 'api') return null;
  // Only accept a single label as a tenant slug
  if (sub.includes('.')) return null;
  return sub;
}

/**
 * Resolves tenant context from `x-tenant-id` header (UUID or slug) or from
 * the request subdomain (when TENANT_DOMAIN_BASE is configured), and
 * attaches it to req.tenant.
 *
 * The actual `SELECT set_tenant_context($1::uuid)` call is performed
 * per-DB-connection inside withTenantClient(), guaranteeing RLS is
 * activated for every query in services/repositories.
 */
export function setTenantContextMiddleware() {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const headerVal = req.header(env.TENANT_HEADER);
      let tenantId: string | null = null;
      let slug: string | undefined;

      if (headerVal && headerVal.trim().length > 0) {
        const v = headerVal.trim();
        if (UUID_RE.test(v)) {
          tenantId = v;
        } else {
          slug = v.toLowerCase();
          tenantId = await resolveSlug(slug);
        }
      } else {
        const sub = subdomainFromHost(req.hostname || '');
        if (sub) {
          slug = sub;
          tenantId = await resolveSlug(sub);
        }
      }

      req.tenant = tenantId ? { id: tenantId, slug } : null;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Throws 400 unless a tenant is resolved on req.tenant. */
export function requireTenant() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.tenant?.id) {
      return next(new BadRequestError('Tenant context required', { reason: 'missing_tenant' }));
    }
    next();
  };
}
