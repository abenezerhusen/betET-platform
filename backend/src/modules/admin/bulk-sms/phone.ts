/**
 * Phone-number normalization + validation for the Bulk SMS module.
 *
 * Rules (spec — "Excel Phone Number Import"):
 *   - strip spaces, dashes, dots and parentheses
 *   - `00xx` → `+xx`
 *   - already `+xx…` → kept as-is
 *   - leading `0` → replaced with the tenant's default country code
 *   - bare national number → prefixed with the default country code
 *   - final value must match a loose E.164 shape (`+` then 7–15 digits)
 *
 * Returns `null` for anything that cannot be turned into a valid number so
 * the caller can count it as "invalid" in the import preview.
 */

const E164 = /^\+\d{7,15}$/;

export function normalizePhone(
  raw: string,
  defaultCountryCode: string
): string | null {
  if (!raw) return null;
  let s = String(raw).replace(/[\s\-().]/g, '');
  if (!s) return null;

  // Normalise the configured country code to `+<digits>`.
  const ccDigits = defaultCountryCode.replace(/[^\d]/g, '');
  const cc = ccDigits ? `+${ccDigits}` : '';

  if (s.startsWith('00')) {
    s = `+${s.slice(2)}`;
  }

  if (s.startsWith('+')) {
    return E164.test(s) ? s : null;
  }

  // Strip any non-digits that survived (e.g. a stray letter → invalid).
  if (/[^\d]/.test(s)) return null;

  if (s.startsWith('0')) {
    if (!cc) return null;
    s = `${cc}${s.slice(1)}`;
  } else if (ccDigits && s.startsWith(ccDigits)) {
    s = `+${s}`;
  } else if (cc) {
    s = `${cc}${s}`;
  } else {
    s = `+${s}`;
  }

  return E164.test(s) ? s : null;
}

export interface PhoneImportResult {
  /** Unique, normalized, valid numbers ready to queue. */
  valid: string[];
  total: number;
  invalid: number;
  duplicates: number;
}

/**
 * Normalizes a raw list, dropping invalids and de-duplicating. Used both for
 * the client-side preview (mirrored in the admin panel) and as the server-side
 * source of truth at campaign-creation time.
 */
export function normalizePhoneList(
  raw: string[],
  defaultCountryCode: string
): PhoneImportResult {
  const seen = new Set<string>();
  const valid: string[] = [];
  let invalid = 0;
  let duplicates = 0;

  for (const entry of raw) {
    const normalized = normalizePhone(entry, defaultCountryCode);
    if (!normalized) {
      invalid += 1;
      continue;
    }
    if (seen.has(normalized)) {
      duplicates += 1;
      continue;
    }
    seen.add(normalized);
    valid.push(normalized);
  }

  return { valid, total: raw.length, invalid, duplicates };
}

/**
 * Substitutes `{key}` placeholders using the provided variables. Unknown
 * placeholders are replaced with an empty string so raw `{name}` tokens never
 * reach a customer's handset.
 */
export function renderMessage(
  body: string,
  vars: Record<string, string> | undefined
): string {
  if (!vars) return body.replace(/\{(\w+)\}/g, '');
  return body.replace(/\{(\w+)\}/g, (_m, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : ''
  );
}
