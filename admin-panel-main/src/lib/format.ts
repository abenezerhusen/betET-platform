/**
 * Formatting helpers used by data-driven pages.
 *
 * The backend returns numeric amounts as strings (Postgres NUMERIC) so we
 * accept both string and number and produce a stable display value.
 */

export function toNumber(input: string | number | null | undefined): number {
  if (input === null || input === undefined || input === '') return 0;
  const n = typeof input === 'number' ? input : Number(input);
  return Number.isFinite(n) ? n : 0;
}

export const DEFAULT_CURRENCY: string =
  (import.meta.env.VITE_DEFAULT_CURRENCY as string | undefined) ?? 'ETB';

let cachedFormatter: Intl.NumberFormat | null = null;
let cachedFormatterCurrency: string | null = null;

function getFormatter(currency: string): Intl.NumberFormat {
  if (cachedFormatter && cachedFormatterCurrency === currency) return cachedFormatter;
  try {
    cachedFormatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    });
    cachedFormatterCurrency = currency;
  } catch {
    cachedFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
    cachedFormatterCurrency = currency;
  }
  return cachedFormatter;
}

export function formatCurrency(
  input: string | number | null | undefined,
  currency: string = DEFAULT_CURRENCY
): string {
  return getFormatter(currency).format(toNumber(input));
}

export function formatInteger(input: string | number | null | undefined): string {
  return new Intl.NumberFormat('en-US').format(Math.round(toNumber(input)));
}

export function formatPercent(
  input: string | number | null | undefined,
  digits = 1
): string {
  const n = toNumber(input);
  return `${(n * 100).toFixed(digits)}%`;
}

/** Convert a Date to YYYY-MM-DDTHH:MM:SSZ; safe to pass into backend ?from=/?to=. */
export function toIso(d: Date | string | null | undefined): string | undefined {
  if (!d) return undefined;
  if (typeof d === 'string') return d;
  return d.toISOString();
}
