import NodeCache from 'node-cache';

/**
 * Per-process in-memory cache for heavy admin reports.
 * - stdTTL: 60 seconds, matching the spec.
 * - useClones: false to avoid the cost of structuredClone on every read; we
 *   never mutate cached values (they are returned as JSON to clients).
 */
const cache = new NodeCache({
  stdTTL: 60,
  checkperiod: 120,
  useClones: false,
});

export function buildKey(name: string, params: Record<string, unknown>): string {
  return `${name}:${stableStringify(params)}`;
}

export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  factory: () => Promise<T>
): Promise<T> {
  const hit = cache.get<T>(key);
  if (hit !== undefined) return hit;
  const value = await factory();
  cache.set(key, value, ttlSeconds);
  return value;
}

export function invalidate(prefix?: string): void {
  if (!prefix) {
    cache.flushAll();
    return;
  }
  const matching = cache.keys().filter((k) => k.startsWith(prefix));
  if (matching.length) cache.del(matching);
}

/** JSON.stringify with deterministic key ordering so cache keys are stable. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}
