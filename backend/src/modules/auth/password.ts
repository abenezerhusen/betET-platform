import bcrypt from 'bcrypt';
import { env } from '../../config/env';

/**
 * Hash a plaintext password with bcrypt at the configured cost (default 12).
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_COST);
}

/**
 * Constant-time bcrypt comparison.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/**
 * A precomputed bcrypt hash (lazily generated once) used for timing-safe
 * verification when the user record does not exist. Calling bcrypt.compare
 * against this hash takes roughly the same time as a real password check,
 * so unauthenticated attackers cannot probe for valid accounts based on
 * response latency alone.
 */
let _dummyHash: string | null = null;
export async function getDummyHash(): Promise<string> {
  if (!_dummyHash) {
    _dummyHash = await bcrypt.hash(
      'a-fixed-string-for-timing-safety-only',
      env.BCRYPT_COST
    );
  }
  return _dummyHash;
}
