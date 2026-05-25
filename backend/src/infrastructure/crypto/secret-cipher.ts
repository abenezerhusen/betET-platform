/**
 * AES-256-GCM seal/open helper.
 *
 * Stored format (string): `${ivHex}:${ciphertextHex}:${tagHex}`
 *
 * Used for sealing external_game_providers.encrypted_secret (and any
 * api_integrations secret rotation that the spec requires never echo plain
 * text back to the frontend). The key comes from env.encryptionKey which is
 * either ENCRYPTION_KEY=<64-hex> in production or a deterministic per-process
 * fallback in development.
 */
import crypto from 'node:crypto';
import { env } from '../../config/env';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

export function sealSecret(plain: string): string {
  if (!plain || plain.length === 0) return '';
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, env.encryptionKey, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${enc.toString('hex')}:${tag.toString('hex')}`;
}

export function openSecret(stored: string | null | undefined): string {
  if (!stored) return '';
  const parts = stored.split(':');
  if (parts.length !== 3) {
    throw new Error('Sealed secret payload is malformed');
  }
  const [ivHex, encHex, tagHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const enc = Buffer.from(encHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGO, env.encryptionKey, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

/** Returns a masked indicator like `••••••••••••AB12` for UI display. */
export function maskSecretSummary(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const plain = openSecret(stored);
    if (!plain) return null;
    const tail = plain.slice(-4);
    return `••••••••••••${tail}`;
  } catch {
    return '••••••••••••????';
  }
}
