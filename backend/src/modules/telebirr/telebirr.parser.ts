/**
 * Telebirr SMS parser (PART 1 of the Telebirr ingestion pipeline).
 *
 * Pure logic — no I/O, no DB, no time, no randomness. All inputs are
 * captured in the function arguments so the parser is trivially unit
 * testable and replayable against historical SMS bodies.
 *
 * Telebirr SMS variants we recognise:
 *   - "received":   ETB credited to the agent number (the only kind that
 *                   can match a deposit and credit a wallet).
 *   - "sent":       ETB debited from the agent number (used for audit and
 *                   future reconciliation; never credits a wallet).
 *   - "topup":      airtime / data top-up notifications (ignored).
 *   - "unknown":    not recognisable as any of the above.
 *
 * The matcher (PART 2) only acts on `type === 'received'`.
 *
 * NOTE on grammar:
 *   Ethio Telecom changes Telebirr SMS wording from time to time
 *   (capitalisation, "Birr" vs "ETB", "from"/"sender", trailing dates).
 *   We deliberately keep the regexes loose and field-by-field so a small
 *   wording change does not nuke matching — confidence is downgraded
 *   instead of returning `unknown` whenever possible.
 */

export type SmsType = 'received' | 'sent' | 'topup' | 'unknown';
export type ParseConfidence = 'high' | 'medium' | 'low';

export interface ParsedSms {
  type: SmsType;
  amount: number;
  currency: 'ETB';
  senderPhone: string | null;
  senderName: string | null;
  receiverPhone: string | null;
  receiverName: string | null;
  telebirrRef: string | null;
  newBalance: number | null;
  rawDate: string | null;
  /**
   * Candidate alphanumeric tokens (length 6–8) extracted from the SMS body
   * that *might* be our deposit reference code. The matcher tries each
   * against `telebirr_deposit_requests.reference_code` in turn.
   *
   * Excludes the Telebirr Ref itself so we never collide on it.
   */
  noteCandidates: string[];
  confidence: ParseConfidence;
}

/* ------------------------------------------------------------------------- */
/* Phone normalisation                                                       */
/* ------------------------------------------------------------------------- */

/**
 * Normalise an Ethiopian mobile number to the canonical 10-digit
 * 0XXXXXXXXX form so we can do equality lookups against `users.phone`.
 *
 * Accepts:
 *   "0911234567"    -> "0911234567"
 *   "+251911234567" -> "0911234567"
 *   "251911234567"  -> "0911234567"
 *   "911234567"     -> "0911234567"  (some SMS strip the leading 0)
 *
 * Returns null when the input cannot be unambiguously interpreted as an
 * Ethiopian mobile number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;

  // Strip everything that is not a digit or a leading '+'.
  s = s.replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(s)) return null;

  if (s.startsWith('+251')) s = '0' + s.slice(4);
  else if (s.startsWith('251')) s = '0' + s.slice(3);
  else if (s.startsWith('00251')) s = '0' + s.slice(5);
  else if (s.length === 9 && s.startsWith('9')) s = '0' + s;

  // Final shape: 10 digits starting with 09 (mobile) or 07 (some MNOs).
  // Telebirr is Ethio Telecom mobile money — we accept 09… and 07…
  // (Ethio Telecom started using 07 prefixes for certain SIM ranges).
  if (/^0[79]\d{8}$/.test(s)) return s;
  return null;
}

/* ------------------------------------------------------------------------- */
/* Amount parsing                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Parse a decimal amount that may include comma thousand separators.
 * Returns null when the input is missing or not a finite non-negative
 * number.
 *
 *   "1,500.00" -> 1500
 *   "500"      -> 500
 *   "1.234,56" -> null   (European formatting is NOT Telebirr's format)
 */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const cleaned = String(raw).trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

const AMOUNT_RE =
  /(?:ETB|Birr)[.\s]*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*(?:ETB|Birr)/i;
// Matches the reference token across Ethio Telecom's wording variants, most
// importantly the live format "Your transaction number is DGD2T2M9YQ." plus
// "Transaction Id: X", "Ref No X", "TXN X", etc. Longer alternatives are
// listed first so "Number" wins over "No"/"Num".
const REF_RE =
  /\b(?:Trans(?:action)?\s*(?:Number|Num|Id|No\.?)|Ref(?:erence)?(?:\s*(?:Number|Num|Id|No\.?|Code))?|TXN|TxnId)\s*(?:is|:|#|-|=)?\s*([A-Za-z0-9]{4,})/i;
const NEW_BALANCE_RE =
  /(?:new|current|available)\s+balance(?:\s+is)?\s*[:\s]?\s*(?:ETB|Birr)?\s*([\d,]+(?:\.\d+)?)/i;
const DATE_RE =
  /(\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?|\d{1,2}-[A-Za-z]{3}-\d{2,4})/i;

const PHONE_IN_PARENS_RE =
  /\((\+?2?5?1?0?\d{8,9})\)/;
const BARE_PHONE_RE =
  /(?<!\d)(\+?251\d{9}|\b0\d{9}\b)(?!\d)/;

const NAME_FROM_RE =
  /\bfrom\s+([A-Za-z][A-Za-z .'`-]{1,80}?)\s*(?:\(|on\b|\.|,|\s\d)/i;
const NAME_TO_RE =
  /\bto\s+([A-Za-z][A-Za-z .'`-]{1,80}?)\s*(?:\(|on\b|\.|,|\s\d)/i;

const NOTE_CANDIDATE_RE = /\b[A-Z0-9]{6,8}\b/g;

function detectType(body: string): SmsType {
  const b = body.toLowerCase();

  // Top-up / airtime variants come first because they often contain the
  // word "credited" too ("Your airtime has been credited…").
  if (
    /\b(airtime|air[ -]?time|top[ -]?up|recharge|data\s+bundle|mobile\s+pack(age)?)\b/i.test(
      body
    ) &&
    !/transferred to your telebirr account/i.test(body)
  ) {
    return 'topup';
  }

  if (/\b(credited|received|deposited)\b/.test(b)) return 'received';
  if (/\b(debited|paid|sent|transferred to)\b/.test(b)) return 'sent';
  return 'unknown';
}

function extractAmount(body: string): number | null {
  const m = body.match(AMOUNT_RE);
  if (!m) return null;
  return parseAmount(m[1] ?? m[2]);
}

function extractRef(body: string): string | null {
  const m = body.match(REF_RE);
  if (!m) return null;
  // Strip a stray trailing period ("Ref: ABC123.") that the regex may include.
  return m[1].replace(/\.$/, '');
}

function extractNewBalance(body: string): number | null {
  const m = body.match(NEW_BALANCE_RE);
  return m ? parseAmount(m[1]) : null;
}

function extractRawDate(body: string): string | null {
  const m = body.match(DATE_RE);
  return m ? m[1] : null;
}

/**
 * Pull a phone out of a parenthesised group first ("from John Doe
 * (0911234567)"). If that fails, fall back to a bare phone number after
 * the relevant keyword.
 */
function extractPhoneAfter(body: string, keyword: 'from' | 'to'): string | null {
  const idx = body.toLowerCase().indexOf(keyword + ' ');
  if (idx < 0) return null;
  const after = body.slice(idx, idx + 200);
  const paren = after.match(PHONE_IN_PARENS_RE);
  if (paren) return normalizePhone(paren[1]);
  const bare = after.match(BARE_PHONE_RE);
  if (bare) return normalizePhone(bare[1]);
  return null;
}

function extractName(body: string, kind: 'from' | 'to'): string | null {
  const re = kind === 'from' ? NAME_FROM_RE : NAME_TO_RE;
  const m = body.match(re);
  if (!m) return null;
  return m[1].trim().replace(/\s{2,}/g, ' ');
}

function extractNoteCandidates(
  body: string,
  exclude: Iterable<string | null>
): string[] {
  const blacklist = new Set<string>();
  for (const s of exclude) {
    if (s) blacklist.add(s.toUpperCase());
  }
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(NOTE_CANDIDATE_RE.source, NOTE_CANDIDATE_RE.flags);
  while ((m = re.exec(body)) !== null) {
    const tok = m[0].toUpperCase();
    // Reject all-numeric tokens — those are amounts, balances, or phone
    // fragments. Our deposit codes are intentionally mixed.
    if (/^\d+$/.test(tok)) continue;
    if (blacklist.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/* ------------------------------------------------------------------------- */
/* parseSms                                                                  */
/* ------------------------------------------------------------------------- */

/**
 * Best-effort SMS parser. Always returns a `ParsedSms` (never throws) so
 * the ingestion pipeline can persist + audit even malformed messages.
 *
 * Confidence rules (most→least selective):
 *   - high:   type ∈ {received, sent} AND amount AND telebirrRef AND a phone
 *   - medium: type ∈ {received, sent} AND amount AND (telebirrRef OR phone)
 *   - low:    everything else
 */
export function parseSms(smsBody: string): ParsedSms {
  const body = (smsBody ?? '').trim();
  const empty: ParsedSms = {
    type: 'unknown',
    amount: 0,
    currency: 'ETB',
    senderPhone: null,
    senderName: null,
    receiverPhone: null,
    receiverName: null,
    telebirrRef: null,
    newBalance: null,
    rawDate: null,
    noteCandidates: [],
    confidence: 'low',
  };
  if (!body) return empty;

  const type = detectType(body);

  // Top-up / unknown still get a shallow parse — operators want amount +
  // ref captured for audit even if the matcher will skip them.
  const amount = extractAmount(body) ?? 0;
  const telebirrRef = extractRef(body);
  const newBalance = extractNewBalance(body);
  const rawDate = extractRawDate(body);

  let senderPhone: string | null = null;
  let senderName: string | null = null;
  let receiverPhone: string | null = null;
  let receiverName: string | null = null;

  if (type === 'received') {
    senderPhone = extractPhoneAfter(body, 'from');
    senderName = extractName(body, 'from');
  } else if (type === 'sent') {
    receiverPhone = extractPhoneAfter(body, 'to');
    receiverName = extractName(body, 'to');
  } else {
    // Best-effort even on unknown — phone + name might still be present.
    senderPhone = extractPhoneAfter(body, 'from');
    senderName = extractName(body, 'from');
    receiverPhone = extractPhoneAfter(body, 'to');
    receiverName = extractName(body, 'to');
  }

  const noteCandidates = extractNoteCandidates(body, [telebirrRef]);

  let confidence: ParseConfidence = 'low';
  if (
    (type === 'received' || type === 'sent') &&
    amount > 0 &&
    telebirrRef &&
    (senderPhone || receiverPhone)
  ) {
    confidence = 'high';
  } else if (
    (type === 'received' || type === 'sent') &&
    amount > 0 &&
    (telebirrRef || senderPhone || receiverPhone)
  ) {
    confidence = 'medium';
  }

  return {
    type,
    amount,
    currency: 'ETB',
    senderPhone,
    senderName,
    receiverPhone,
    receiverName,
    telebirrRef,
    newBalance,
    rawDate,
    noteCandidates,
    confidence,
  };
}
