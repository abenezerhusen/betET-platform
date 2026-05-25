import NodeCache from 'node-cache';
import { env } from '../config/env';
import { logger } from './logger';
import { getRedis } from './redis';

/**
 * Two-tier cache abstraction. Backed by Redis when REDIS_URL is set,
 * otherwise an in-memory NodeCache. Both honour TTL semantics; the
 * in-memory store also bounds total entries to avoid unbounded growth
 * in long-lived dev sessions.
 *
 * Cache keys are namespaced by scope so we can blow away an entire
 * surface (e.g. all settings for a tenant) without enumerating keys
 * one by one. Surfaces:
 *
 *   tenant_settings:{tenantId}            (object map of all settings)
 *   tenant_setting:{tenantId}:{key}       (single setting value)
 *   user:{userId}                         (sanitized user record)
 *   wallet_balance:{walletId}             (single wallet snapshot)
 *   games:{tenantId}:{filterHash}         (paginated games list)
 *
 * For Redis we delete by key. For the in-memory tier we additionally
 * track scope memberships in a Map<scope, Set<key>> so a single
 * `invalidateScope('tenant_settings:T')` removes every related entry.
 */

const memCache = new NodeCache({
  stdTTL: env.CACHE_DEFAULT_TTL_SECONDS,
  checkperiod: 30,
  useClones: false,
  maxKeys: 50_000,
});

const memScopeIndex = new Map<string, Set<string>>();

memCache.on('del', (key: string) => {
  for (const scopeSet of memScopeIndex.values()) {
    scopeSet.delete(key);
  }
});
memCache.on('expired', (key: string) => {
  for (const scopeSet of memScopeIndex.values()) {
    scopeSet.delete(key);
  }
});

function indexInScope(scope: string, key: string): void {
  let set = memScopeIndex.get(scope);
  if (!set) {
    set = new Set();
    memScopeIndex.set(scope, set);
  }
  set.add(key);
}

export interface CacheOptions {
  /** TTL in seconds; defaults to CACHE_DEFAULT_TTL_SECONDS. */
  ttl?: number;
  /** Logical scope used by `invalidateScope()`. Optional. */
  scope?: string;
}

/**
 * Read a value from the cache. Returns null on miss or any backend error
 * (we never let cache failures break a request).
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw == null) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn({ err, key }, 'cache get failed');
      return null;
    }
  }
  const v = memCache.get<T>(key);
  return v ?? null;
}

export async function cacheSet<T>(
  key: string,
  value: T,
  opts: CacheOptions = {}
): Promise<void> {
  const ttl = opts.ttl ?? env.CACHE_DEFAULT_TTL_SECONDS;
  const redis = getRedis();
  if (redis) {
    try {
      await redis.set(key, JSON.stringify(value), 'EX', ttl);
      if (opts.scope) {
        // Track membership in a Redis SET so we can purge the scope later.
        await redis.sadd(`__scope__:${opts.scope}`, key);
        await redis.expire(`__scope__:${opts.scope}`, Math.max(ttl * 4, 3600));
      }
      return;
    } catch (err) {
      logger.warn({ err, key }, 'cache set failed; falling back to memory');
    }
  }
  memCache.set(key, value, ttl);
  if (opts.scope) indexInScope(opts.scope, key);
}

export async function cacheDel(key: string | string[]): Promise<void> {
  const keys = Array.isArray(key) ? key : [key];
  if (keys.length === 0) return;
  const redis = getRedis();
  if (redis) {
    try {
      await redis.del(...keys);
      return;
    } catch (err) {
      logger.warn({ err, keys }, 'cache del failed');
    }
  }
  for (const k of keys) memCache.del(k);
}

export async function invalidateScope(scope: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    try {
      const setKey = `__scope__:${scope}`;
      const members = await redis.smembers(setKey);
      if (members.length > 0) await redis.del(...members);
      await redis.del(setKey);
      return;
    } catch (err) {
      logger.warn({ err, scope }, 'cache scope invalidation failed');
    }
  }
  const set = memScopeIndex.get(scope);
  if (set) {
    for (const k of set) memCache.del(k);
    memScopeIndex.delete(scope);
  }
}

/**
 * Convenience wrapper: return a cached value or compute + cache it.
 * Cache misses and computation errors propagate normally.
 */
export async function withCache<T>(
  key: string,
  loader: () => Promise<T>,
  opts: CacheOptions = {}
): Promise<T> {
  const hit = await cacheGet<T>(key);
  if (hit !== null) return hit;
  const value = await loader();
  await cacheSet(key, value, opts);
  return value;
}

/* ------------------------------------------------------------------------- */
/* Scope name helpers — single source of truth, importable by services.      */
/* ------------------------------------------------------------------------- */

export const Scopes = {
  tenantSettings: (tenantId: string) => `tenant_settings:${tenantId}`,
  user: (userId: string) => `user:${userId}`,
  walletBalance: (walletId: string) => `wallet_balance:${walletId}`,
  games: (tenantId: string) => `games:${tenantId}`,
};

export const Keys = {
  tenantSettingsMap: (tenantId: string) => `tenant_settings:${tenantId}:map`,
  tenantSetting: (tenantId: string, key: string) =>
    `tenant_setting:${tenantId}:${key}`,
  user: (userId: string) => `user:${userId}`,
  walletBalance: (walletId: string) => `wallet_balance:${walletId}`,
  gameList: (tenantId: string, filterHash: string) =>
    `games:${tenantId}:${filterHash}`,
};

export function memCacheStats(): {
  keys: number;
  hits: number;
  misses: number;
} {
  const s = memCache.getStats();
  return { keys: s.keys, hits: s.hits, misses: s.misses };
}
