import type { PoolClient } from 'pg';

export interface PaymentMethodRow {
  id: string;
  tenant_id: string;
  provider_slug: string;
  type: string;
  name: string;
  logo_url: string | null;
  min_amount: string | null;
  max_amount: string | null;
  fee_percent: string;
  fee_fixed: string;
  processing_time_hours: number;
  currencies: string[];
  countries: string[];
  supports_deposit: boolean;
  supports_withdrawal: boolean;
  supports_transfer: boolean;
  is_default: boolean;
  is_active: boolean;
  display_order: number;
  config: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

const SELECT_PAYMENT_METHOD = `
  id, tenant_id, provider_slug, type, name, logo_url,
  min_amount, max_amount, fee_percent, fee_fixed,
  processing_time_hours, currencies, countries,
  supports_deposit, supports_withdrawal, supports_transfer,
  is_default, is_active, display_order, config,
  created_at, updated_at
`;

export interface ListPaymentMethodsParams {
  tenantId: string;
  /** When set, restrict to active rows only. */
  activeOnly?: boolean;
  /** When set, require this currency to appear in the row's currencies[]. */
  currency?: string | null;
  /** When set, require this country to appear in the row's countries[]. */
  country?: string | null;
  /** Filter by channel — 'deposit' filters supports_deposit=true, etc. */
  channel?: 'deposit' | 'withdrawal' | 'transfer' | null;
}

export async function listPaymentMethods(
  client: PoolClient,
  params: ListPaymentMethodsParams
): Promise<PaymentMethodRow[]> {
  const filters: string[] = ['tenant_id = $1'];
  const values: unknown[] = [params.tenantId];
  let i = 2;
  if (params.activeOnly) {
    filters.push(`is_active = true`);
  }
  if (params.currency) {
    filters.push(`$${i++} = ANY(currencies)`);
    values.push(params.currency);
  }
  if (params.country) {
    filters.push(`$${i++} = ANY(countries)`);
    values.push(params.country);
  }
  if (params.channel === 'deposit') {
    filters.push(`supports_deposit = true`);
  } else if (params.channel === 'withdrawal') {
    filters.push(`supports_withdrawal = true`);
  } else if (params.channel === 'transfer') {
    filters.push(`supports_transfer = true`);
  }
  const r = await client.query<PaymentMethodRow>(
    `SELECT ${SELECT_PAYMENT_METHOD}
       FROM payment_methods
      WHERE ${filters.join(' AND ')}
      ORDER BY display_order ASC, created_at ASC`,
    values
  );
  return r.rows;
}

export async function findPaymentMethodById(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<PaymentMethodRow | null> {
  const r = await client.query<PaymentMethodRow>(
    `SELECT ${SELECT_PAYMENT_METHOD}
       FROM payment_methods
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}

export async function findPaymentMethodBySlug(
  client: PoolClient,
  tenantId: string,
  providerSlug: string
): Promise<PaymentMethodRow | null> {
  const r = await client.query<PaymentMethodRow>(
    `SELECT ${SELECT_PAYMENT_METHOD}
       FROM payment_methods
      WHERE tenant_id = $1 AND provider_slug = $2
      LIMIT 1`,
    [tenantId, providerSlug]
  );
  return r.rows[0] ?? null;
}

export interface UpsertPaymentMethodParams {
  tenantId: string;
  providerSlug: string;
  type: string;
  name: string;
  logoUrl: string | null;
  minAmount: string | null;
  maxAmount: string | null;
  feePercent: string;
  feeFixed: string;
  processingTimeHours: number;
  currencies: string[];
  countries: string[];
  supportsDeposit: boolean;
  supportsWithdrawal: boolean;
  supportsTransfer?: boolean;
  isDefault?: boolean;
  isActive: boolean;
  displayOrder: number;
  config: Record<string, unknown>;
}

/**
 * Insert a payment_methods row, leaving it untouched if a row with
 * the same (tenant_id, provider_slug) already exists. Used by the
 * tenant-bootstrap helper that seeds the default Telebirr P2P entry
 * — never silently overwrites an admin's customisations.
 */
export async function insertPaymentMethodIfMissing(
  client: PoolClient,
  params: UpsertPaymentMethodParams
): Promise<{ inserted: boolean; row: PaymentMethodRow }> {
  const r = await client.query<PaymentMethodRow & { __inserted: boolean }>(
    `WITH ins AS (
       INSERT INTO payment_methods
         (tenant_id, provider_slug, type, name, logo_url,
          min_amount, max_amount, fee_percent, fee_fixed,
          processing_time_hours, currencies, countries,
          supports_deposit, supports_withdrawal, supports_transfer,
          is_default, is_active, display_order, config)
       VALUES ($1, $2, $3, $4, $5,
               $6::numeric, $7::numeric, $8::numeric, $9::numeric,
               $10::int, $11::text[], $12::text[],
               $13, $14, $15, $16, $17, $18, $19::jsonb)
       ON CONFLICT (tenant_id, provider_slug) DO NOTHING
       RETURNING ${SELECT_PAYMENT_METHOD}, true AS __inserted
     )
     SELECT * FROM ins
     UNION ALL
     SELECT ${SELECT_PAYMENT_METHOD}, false AS __inserted
       FROM payment_methods
      WHERE tenant_id = $1 AND provider_slug = $2
        AND NOT EXISTS (SELECT 1 FROM ins)`,
    [
      params.tenantId,
      params.providerSlug,
      params.type,
      params.name,
      params.logoUrl,
      params.minAmount,
      params.maxAmount,
      params.feePercent,
      params.feeFixed,
      params.processingTimeHours,
      params.currencies,
      params.countries,
      params.supportsDeposit,
      params.supportsWithdrawal,
      params.supportsTransfer ?? false,
      params.isDefault ?? false,
      params.isActive,
      params.displayOrder,
      JSON.stringify(params.config),
    ]
  );
  if (!r.rows[0]) {
    throw new Error('insertPaymentMethodIfMissing produced no row');
  }
  const { __inserted, ...row } = r.rows[0] as PaymentMethodRow & {
    __inserted: boolean;
  };
  return { inserted: __inserted, row };
}

export interface UpdatePaymentMethodPatch {
  name?: string;
  logoUrl?: string | null;
  minAmount?: string | null;
  maxAmount?: string | null;
  feePercent?: string;
  feeFixed?: string;
  processingTimeHours?: number;
  currencies?: string[];
  countries?: string[];
  supportsDeposit?: boolean;
  supportsWithdrawal?: boolean;
  supportsTransfer?: boolean;
  isDefault?: boolean;
  isActive?: boolean;
  displayOrder?: number;
  config?: Record<string, unknown>;
}

export async function updatePaymentMethod(
  client: PoolClient,
  tenantId: string,
  id: string,
  patch: UpdatePaymentMethodPatch
): Promise<PaymentMethodRow | null> {
  const sets: string[] = [];
  const values: unknown[] = [tenantId, id];
  let i = 3;
  const add = (col: string, value: unknown, cast?: string) => {
    sets.push(`${col} = $${i}${cast ? `::${cast}` : ''}`);
    values.push(value);
    i++;
  };
  if (patch.name !== undefined) add('name', patch.name);
  if (patch.logoUrl !== undefined) add('logo_url', patch.logoUrl);
  if (patch.minAmount !== undefined) add('min_amount', patch.minAmount, 'numeric');
  if (patch.maxAmount !== undefined) add('max_amount', patch.maxAmount, 'numeric');
  if (patch.feePercent !== undefined) add('fee_percent', patch.feePercent, 'numeric');
  if (patch.feeFixed !== undefined) add('fee_fixed', patch.feeFixed, 'numeric');
  if (patch.processingTimeHours !== undefined)
    add('processing_time_hours', patch.processingTimeHours);
  if (patch.currencies !== undefined) add('currencies', patch.currencies, 'text[]');
  if (patch.countries !== undefined) add('countries', patch.countries, 'text[]');
  if (patch.supportsDeposit !== undefined)
    add('supports_deposit', patch.supportsDeposit);
  if (patch.supportsWithdrawal !== undefined)
    add('supports_withdrawal', patch.supportsWithdrawal);
  if (patch.supportsTransfer !== undefined)
    add('supports_transfer', patch.supportsTransfer);
  if (patch.isDefault !== undefined) add('is_default', patch.isDefault);
  if (patch.isActive !== undefined) add('is_active', patch.isActive);
  if (patch.displayOrder !== undefined) add('display_order', patch.displayOrder);
  if (patch.config !== undefined)
    add('config', JSON.stringify(patch.config), 'jsonb');

  if (sets.length === 0) {
    return findPaymentMethodById(client, tenantId, id);
  }

  const r = await client.query<PaymentMethodRow>(
    `UPDATE payment_methods
        SET ${sets.join(', ')}, updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING ${SELECT_PAYMENT_METHOD}`,
    values
  );
  return r.rows[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* Section 21 — create / delete                                                */
/* -------------------------------------------------------------------------- */

export interface CreatePaymentMethodParams extends UpsertPaymentMethodParams {}

/**
 * Insert a brand-new payment method row. Returns the inserted row, or
 * throws if the (tenant_id, provider_slug) already exists. Callers
 * should catch the unique-violation and surface a 409 to the API.
 */
export async function createPaymentMethod(
  client: PoolClient,
  params: CreatePaymentMethodParams
): Promise<PaymentMethodRow> {
  const r = await client.query<PaymentMethodRow>(
    `INSERT INTO payment_methods
       (tenant_id, provider_slug, type, name, logo_url,
        min_amount, max_amount, fee_percent, fee_fixed,
        processing_time_hours, currencies, countries,
        supports_deposit, supports_withdrawal, supports_transfer,
        is_default, is_active, display_order, config)
     VALUES ($1, $2, $3, $4, $5,
             $6::numeric, $7::numeric, $8::numeric, $9::numeric,
             $10::int, $11::text[], $12::text[],
             $13, $14, $15, $16, $17, $18, $19::jsonb)
     RETURNING ${SELECT_PAYMENT_METHOD}`,
    [
      params.tenantId,
      params.providerSlug,
      params.type,
      params.name,
      params.logoUrl,
      params.minAmount,
      params.maxAmount,
      params.feePercent,
      params.feeFixed,
      params.processingTimeHours,
      params.currencies,
      params.countries,
      params.supportsDeposit,
      params.supportsWithdrawal,
      params.supportsTransfer ?? false,
      params.isDefault ?? false,
      params.isActive,
      params.displayOrder,
      JSON.stringify(params.config),
    ]
  );
  if (!r.rows[0]) {
    throw new Error('createPaymentMethod produced no row');
  }
  return r.rows[0];
}

export async function deletePaymentMethod(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<boolean> {
  const r = await client.query(
    `DELETE FROM payment_methods WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id]
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Atomically set ONE payment method as the default for a tenant by
 * clearing the flag on every other row first. Wrapped in a single
 * transaction by the caller via withTenantClient.
 */
export async function setDefaultPaymentMethod(
  client: PoolClient,
  tenantId: string,
  id: string
): Promise<PaymentMethodRow | null> {
  await client.query(
    `UPDATE payment_methods
        SET is_default = false, updated_at = now()
      WHERE tenant_id = $1 AND is_default = true AND id <> $2`,
    [tenantId, id]
  );
  const r = await client.query<PaymentMethodRow>(
    `UPDATE payment_methods
        SET is_default = true, updated_at = now()
      WHERE tenant_id = $1 AND id = $2
      RETURNING ${SELECT_PAYMENT_METHOD}`,
    [tenantId, id]
  );
  return r.rows[0] ?? null;
}
