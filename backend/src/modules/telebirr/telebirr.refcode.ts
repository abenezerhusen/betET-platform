import crypto from 'crypto';

/**
 * Reference-code generator.
 *
 * Telebirr deposit codes have to be typed by hand into the Telebirr
 * "note / reason" field on a phone keypad. To minimise typo-driven
 * mismatches:
 *   - Uppercase only.
 *   - Drop the visually ambiguous characters: 0/O, 1/I/L, B/8, S/5
 *     are all kept as a single canonical form (we keep the easier-to-
 *     read letter from each pair, drop the digit that looks like it).
 *   - Cryptographically-random source so brute-force guessing the
 *     reference code is not a viable attack against Strategy 1.
 *
 * We expose the prefix as configurable so tenants can use their brand
 * (e.g. "ET" or "BET" instead of "TB"). Length is also configurable
 * (3..6 random chars) — total code length stays <= 8 to fit the
 * `varchar(8)` column on `telebirr_deposit_requests`.
 */

const ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ234679';
//                 ^ no I, O                 ^ no 0, 1, 5, 8 (look-alikes)

export interface RefCodeOptions {
  /** Static letters at the start, e.g. "TB". Empty string → no prefix. */
  prefix: string;
  /** Number of random chars after the prefix. Total length = prefix.length + length. */
  length: number;
}

export function generateReferenceCode(opts: RefCodeOptions): string {
  if (opts.length < 1) {
    throw new Error('refcode length must be >= 1');
  }
  const buf = crypto.randomBytes(opts.length);
  let out = '';
  for (let i = 0; i < opts.length; i += 1) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return `${opts.prefix}${out}`;
}

/**
 * Generate a code, retrying when a uniqueness predicate rejects it.
 * The predicate returns `true` to ACCEPT and `false` to retry. Throws
 * after `maxAttempts` consecutive collisions (in practice this should
 * never happen with a well-tuned alphabet × length, so we bubble up
 * as a 503-ready exception).
 */
export async function generateUniqueReferenceCode(
  opts: RefCodeOptions,
  isAvailable: (candidate: string) => Promise<boolean>,
  maxAttempts = 8
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = generateReferenceCode(opts);
    // eslint-disable-next-line no-await-in-loop
    if (await isAvailable(candidate)) return candidate;
  }
  throw new Error(
    `Could not generate a unique reference code after ${maxAttempts} attempts; widen reference_code_length`
  );
}
