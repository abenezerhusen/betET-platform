import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_PRIVATE_KEY_PATH: z.string().optional(),
  JWT_PUBLIC_KEY_PATH: z.string().optional(),
  JWT_ACCESS_TOKEN_TTL: z.string().default('15m'),
  JWT_REFRESH_TOKEN_TTL: z.string().default('7d'),
  JWT_ISSUER: z.string().default('betet-platform'),
  JWT_AUDIENCE: z.string().default('betet-platform'),

  BCRYPT_COST: z.coerce.number().int().min(8).max(15).default(12),
  // Spec defaults — overridable per environment / per tenant via security_settings.
  // 5 failed logins → 15 minute account lock; password reset link valid 60 min.
  MAX_FAILED_LOGIN_ATTEMPTS: z.coerce.number().int().positive().default(5),
  ACCOUNT_LOCK_DURATION_MINUTES: z.coerce.number().int().positive().default(15),
  PASSWORD_RESET_TOKEN_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),

  TENANT_HEADER: z.string().default('x-tenant-id'),
  TENANT_DOMAIN_BASE: z.string().optional(),
  CORS_ALLOWED_ORIGINS: z.string().default(''),

  // Connection pool: max simultaneous connections from this process.
  // Multi-tenancy is enforced by RLS, not by separate pools per tenant.
  // Set conservatively per process; horizontal scale adds more processes.
  PG_POOL_MAX: z.coerce.number().int().positive().max(200).default(20),
  PG_POOL_IDLE_MS: z.coerce.number().int().nonnegative().default(30_000),
  PG_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),

  // Optional Redis cache. When unset the cache layer transparently falls
  // back to an in-memory LRU so dev / single-process deployments still work.
  REDIS_URL: z.string().optional(),
  REDIS_KEY_PREFIX: z.string().default('betet:'),
  CACHE_DEFAULT_TTL_SECONDS: z.coerce.number().int().positive().default(60),

  // Rate-limit defaults used by middleware (per-window).
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_BET_PER_MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_ADMIN_REPORTS_PER_MIN: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_GENERAL_PER_MIN: z.coerce.number().int().positive().default(100),

  /* ----------------------------------------------------------------------- */
  /* Telebirr SMS Pay Client (Flutter agent app)                             */
  /* ----------------------------------------------------------------------- */
  // HS256 secret used ONLY to sign agent device tokens. MUST be different
  // from the user JWT (RS256) keypair so a user token can never be replayed
  // as an agent token, and vice versa.
  AGENT_JWT_SECRET: z.string().optional(),
  AGENT_JWT_ISSUER: z.string().default('betet-platform-agent'),
  AGENT_JWT_AUDIENCE: z.string().default('betet-platform-agent'),
  // Spec calls for ~12h. Override per environment.
  AGENT_JWT_TTL: z.string().default('12h'),

  // Login: 10 attempts per device per hour (spec).
  AGENT_LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  AGENT_LOGIN_RATE_LIMIT_WINDOW_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  // All other agent endpoints: 200/min keyed by agent (spec).
  AGENT_RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(200),

  /* ----------------------------------------------------------------------- */
  /* Encryption + external integrations                                      */
  /* ----------------------------------------------------------------------- */
  // 32-byte hex key used to seal external_game_providers.encrypted_secret
  // (AES-256-GCM). When omitted in development we derive a deterministic
  // key from JWT_PRIVATE_KEY so dev round-trips work without extra setup.
  ENCRYPTION_KEY: z.string().optional(),

  // Public-facing URL of THIS backend — used to build webhook callback URLs
  // we hand to external game providers.
  BACKEND_URL: z.string().optional(),
  // Public URL of the game engine that hosts internal games (port 3002 by
  // default). Used by /embed to redirect after security checks pass.
  GAME_ENGINE_URL: z.string().default('http://localhost:3002'),
  // Default redirect for `return_url` when a player exits an external game.
  FRONTEND_URL: z.string().default('http://localhost:3000'),
});

const parsed = envSchema.parse(process.env);

function loadKey(direct: string | undefined, filePath: string | undefined, label: string): string {
  if (direct && direct.trim().length > 0) {
    const v = direct.trim();
    if (v.includes('-----BEGIN')) return v;
    return Buffer.from(v, 'base64').toString('utf-8');
  }
  if (filePath) {
    return fs.readFileSync(path.resolve(filePath), 'utf-8');
  }
  throw new Error(
    `JWT ${label} is not configured. Set JWT_${label.toUpperCase()}_KEY or JWT_${label.toUpperCase()}_KEY_PATH.`
  );
}

let cachedPrivateKey: string | null = null;
let cachedPublicKey: string | null = null;
let cachedDevAgentSecret: string | null = null;
let cachedEncryptionKey: Buffer | null = null;

export const env = {
  NODE_ENV: parsed.NODE_ENV,
  PORT: parsed.PORT,
  HOST: parsed.HOST,
  LOG_LEVEL: parsed.LOG_LEVEL,
  DATABASE_URL: parsed.DATABASE_URL,

  BCRYPT_COST: parsed.BCRYPT_COST,
  MAX_FAILED_LOGIN_ATTEMPTS: parsed.MAX_FAILED_LOGIN_ATTEMPTS,
  ACCOUNT_LOCK_DURATION_MINUTES: parsed.ACCOUNT_LOCK_DURATION_MINUTES,
  PASSWORD_RESET_TOKEN_TTL_MINUTES: parsed.PASSWORD_RESET_TOKEN_TTL_MINUTES,

  LOGIN_RATE_LIMIT_MAX: parsed.LOGIN_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: parsed.LOGIN_RATE_LIMIT_WINDOW_MINUTES,

  TENANT_HEADER: parsed.TENANT_HEADER.toLowerCase(),
  TENANT_DOMAIN_BASE: parsed.TENANT_DOMAIN_BASE?.toLowerCase(),
  CORS_ALLOWED_ORIGINS: parsed.CORS_ALLOWED_ORIGINS,

  PG_POOL_MAX: parsed.PG_POOL_MAX,
  PG_POOL_IDLE_MS: parsed.PG_POOL_IDLE_MS,
  PG_POOL_CONNECTION_TIMEOUT_MS: parsed.PG_POOL_CONNECTION_TIMEOUT_MS,

  REDIS_URL: parsed.REDIS_URL,
  REDIS_KEY_PREFIX: parsed.REDIS_KEY_PREFIX,
  CACHE_DEFAULT_TTL_SECONDS: parsed.CACHE_DEFAULT_TTL_SECONDS,

  RATE_LIMIT_AUTH_PER_MIN: parsed.RATE_LIMIT_AUTH_PER_MIN,
  RATE_LIMIT_BET_PER_MIN: parsed.RATE_LIMIT_BET_PER_MIN,
  RATE_LIMIT_ADMIN_REPORTS_PER_MIN: parsed.RATE_LIMIT_ADMIN_REPORTS_PER_MIN,
  RATE_LIMIT_GENERAL_PER_MIN: parsed.RATE_LIMIT_GENERAL_PER_MIN,

  BACKEND_URL: parsed.BACKEND_URL,
  GAME_ENGINE_URL: parsed.GAME_ENGINE_URL,
  FRONTEND_URL: parsed.FRONTEND_URL,

  /**
   * 32-byte AES-256 key for sealing provider secrets at rest. In production
   * this MUST be a 64-char hex string from a secret store; in development we
   * derive a deterministic per-key from JWT_PRIVATE_KEY (or a static
   * fallback) so dev round-trips work without extra setup. Restarts in dev
   * preserve the same key as long as JWT_PRIVATE_KEY is stable.
   */
  get encryptionKey(): Buffer {
    if (cachedEncryptionKey) return cachedEncryptionKey;
    const explicit = (parsed.ENCRYPTION_KEY ?? '').trim();
    if (explicit) {
      const buf = /^[0-9a-fA-F]+$/.test(explicit)
        ? Buffer.from(explicit, 'hex')
        : Buffer.from(explicit, 'utf8');
      if (buf.length < 32) {
        // Pad / hash to 32 bytes when shorter (don't fail in dev).
        const crypto = require('node:crypto') as typeof import('node:crypto');
        cachedEncryptionKey = crypto.createHash('sha256').update(buf).digest();
      } else {
        cachedEncryptionKey = buf.subarray(0, 32);
      }
      return cachedEncryptionKey;
    }
    if (parsed.NODE_ENV === 'production') {
      throw new Error(
        'ENCRYPTION_KEY must be set in production (64-char hex AES-256 key)'
      );
    }
    const crypto = require('node:crypto') as typeof import('node:crypto');
    const seed = parsed.JWT_PRIVATE_KEY ?? 'betet-dev-encryption-seed';
    cachedEncryptionKey = crypto.createHash('sha256').update(seed).digest();
    return cachedEncryptionKey;
  },

  agent: {
    /**
     * HS256 secret. In production we require it to be set explicitly so
     * deployments cannot accidentally fall back to a dev default; in
     * development we synthesise a per-process secret with a one-time
     * warning so `npm run dev` works out of the box.
     */
    get jwtSecret(): string {
      if (parsed.AGENT_JWT_SECRET && parsed.AGENT_JWT_SECRET.length > 0) {
        return parsed.AGENT_JWT_SECRET;
      }
      if (parsed.NODE_ENV === 'production') {
        throw new Error(
          'AGENT_JWT_SECRET must be set in production (separate secret from user JWT)'
        );
      }
      if (!cachedDevAgentSecret) {
        // Deterministic per-process secret so all tokens issued by THIS
        // process verify; restarts invalidate previously issued dev
        // tokens, which is the correct dev behaviour.
        cachedDevAgentSecret = `dev-only-agent-secret-${process.pid}-${Date.now()}`;
        // eslint-disable-next-line no-console
        console.warn(
          '[env] AGENT_JWT_SECRET unset — using ephemeral dev secret. Tokens reset on restart.'
        );
      }
      return cachedDevAgentSecret;
    },
    issuer: parsed.AGENT_JWT_ISSUER,
    audience: parsed.AGENT_JWT_AUDIENCE,
    ttl: parsed.AGENT_JWT_TTL,
    loginRateLimitMax: parsed.AGENT_LOGIN_RATE_LIMIT_MAX,
    loginRateLimitWindowMinutes: parsed.AGENT_LOGIN_RATE_LIMIT_WINDOW_MINUTES,
    rateLimitPerMin: parsed.AGENT_RATE_LIMIT_PER_MIN,
  },

  jwt: {
    get privateKey(): string {
      if (!cachedPrivateKey) {
        cachedPrivateKey = loadKey(parsed.JWT_PRIVATE_KEY, parsed.JWT_PRIVATE_KEY_PATH, 'private');
      }
      return cachedPrivateKey;
    },
    get publicKey(): string {
      if (!cachedPublicKey) {
        cachedPublicKey = loadKey(parsed.JWT_PUBLIC_KEY, parsed.JWT_PUBLIC_KEY_PATH, 'public');
      }
      return cachedPublicKey;
    },
    accessTtl: parsed.JWT_ACCESS_TOKEN_TTL,
    refreshTtl: parsed.JWT_REFRESH_TOKEN_TTL,
    issuer: parsed.JWT_ISSUER,
    audience: parsed.JWT_AUDIENCE,
  },
} as const;

export type Env = typeof env;
