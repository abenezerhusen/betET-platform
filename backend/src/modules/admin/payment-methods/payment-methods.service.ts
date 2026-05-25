import type { Request } from 'express';

import { withTenantClient } from '../../../infrastructure/db/tenant-client';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../../http/errors/http-error';
import { tryAudit } from '../../audit/audit.service';
import * as repo from '../../payments/payment-method.repository';
import {
  providerRegistry,
  seedTelebirrP2PForTenant,
} from '../../payments';

import { getAdminScope, getIp, getUa, requireScopedTenantId } from '../admin-shared';
import type {
  CreatePaymentMethodInput,
  ListPaymentMethodsQuery,
  SeedDefaultsInput,
  TestPaymentMethodInput,
  UpdatePaymentMethodInput,
} from './payment-methods.dto';

/**
 * Section 21 — single mapper used by every endpoint that returns a
 * payment method to the admin UI. Adds derived fields the admin panel
 * relies on (`callback_url`, `display_name`, channel array) so the
 * existing frontend types keep working.
 */
function toView(row: repo.PaymentMethodRow) {
  const callbackUrl =
    typeof row.config?.callback_url === 'string'
      ? (row.config.callback_url as string)
      : null;
  const channels: string[] = [];
  if (row.supports_deposit) channels.push('deposit');
  if (row.supports_withdrawal) channels.push('withdrawal');
  if (row.supports_transfer) channels.push('transfer');
  return {
    id: row.id,
    provider_slug: row.provider_slug,
    provider: row.provider_slug,
    slug: row.provider_slug,
    provider_registered: providerRegistry.has(row.provider_slug),
    type: row.type,
    name: row.name,
    display_name: row.name,
    logo_url: row.logo_url,
    min_amount: row.min_amount,
    max_amount: row.max_amount,
    fee_percent: row.fee_percent,
    fee_fixed: row.fee_fixed,
    processing_time_hours: row.processing_time_hours,
    currencies: row.currencies,
    countries: row.countries,
    supports_deposit: row.supports_deposit,
    supports_withdrawal: row.supports_withdrawal,
    supports_transfer: row.supports_transfer,
    is_default: row.is_default,
    channels,
    callback_url: callbackUrl,
    is_active: row.is_active,
    display_order: row.display_order,
    config: row.config,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export async function listPaymentMethods(
  req: Request,
  query: ListPaymentMethodsQuery
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const rows = await repo.listPaymentMethods(client, {
        tenantId,
        activeOnly: query.active_only ?? false,
        currency: query.currency ?? null,
        country: query.country ?? null,
        channel: query.channel ?? null,
      });
      const items = rows.map(toView);
      return { items, total: items.length };
    }
  );
}

export async function listProviders(req: Request) {
  // No tenant required — providers are global. Just enforce admin auth.
  getAdminScope(req);
  return {
    items: providerRegistry.list().map((p) => ({
      slug: p.getProviderName(),
      wallet_mode: p.getWalletMode(),
      currencies: p.getSupportedCurrencies(),
      countries: p.getSupportedCountries(),
      supports_deposits: p.supportsDeposits(),
      supports_withdrawals: p.supportsWithdrawals(),
    })),
  };
}

export async function getPaymentMethod(req: Request, id: string) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);
  return withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const row = await repo.findPaymentMethodById(client, tenantId, id);
      if (!row) throw new NotFoundError('Payment method not found');
      return toView(row);
    }
  );
}

export async function updatePaymentMethod(
  req: Request,
  id: string,
  body: UpdatePaymentMethodInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const result = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      await client.query('BEGIN');
      try {
        const before = await repo.findPaymentMethodById(client, tenantId, id);
        if (!before) throw new NotFoundError('Payment method not found');

        // If the caller is flipping is_default to TRUE we must clear
        // every other row's flag first to honour the partial UNIQUE
        // index. setDefaultPaymentMethod does this atomically.
        if (body.is_default === true) {
          await repo.setDefaultPaymentMethod(client, tenantId, id);
        }

        const after = await repo.updatePaymentMethod(client, tenantId, id, {
          name: body.name,
          logoUrl: body.logo_url ?? undefined,
          minAmount: body.min_amount ?? undefined,
          maxAmount: body.max_amount ?? undefined,
          feePercent: body.fee_percent,
          feeFixed: body.fee_fixed,
          processingTimeHours: body.processing_time_hours,
          currencies: body.currencies,
          countries: body.countries,
          supportsDeposit: body.supports_deposit,
          supportsWithdrawal: body.supports_withdrawal,
          supportsTransfer: body.supports_transfer,
          isDefault: body.is_default === true ? undefined : body.is_default,
          isActive: body.is_active,
          displayOrder: body.display_order,
          config: body.config,
        });
        await client.query('COMMIT');
        return { before, after };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.payment_methods.update',
      resource: 'payment_method',
      resourceId: id,
      payload: { before: result.before, after: result.after },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return result.after ? toView(result.after) : null;
}

/* -------------------------------------------------------------------------- */
/* Section 21 — Tab 3: create / delete / test connection                       */
/* -------------------------------------------------------------------------- */

export async function createPaymentMethod(
  req: Request,
  body: CreatePaymentMethodInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const created = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      await client.query('BEGIN');
      try {
        // Reject duplicate provider slugs up front for a clean 409
        // instead of letting Postgres raise a unique-violation.
        const existing = await repo.findPaymentMethodBySlug(
          client,
          tenantId,
          body.provider_slug
        );
        if (existing) {
          throw new ConflictError(
            `Payment method "${body.provider_slug}" already exists for this tenant.`
          );
        }

        // If the new row claims to be the default, clear any other
        // row's flag in the same transaction. We do this BEFORE the
        // insert so the partial UNIQUE INDEX never trips.
        if (body.is_default) {
          await client.query(
            `UPDATE payment_methods
                SET is_default = false, updated_at = now()
              WHERE tenant_id = $1 AND is_default = true`,
            [tenantId]
          );
        }

        const row = await repo.createPaymentMethod(client, {
          tenantId,
          providerSlug: body.provider_slug,
          type: body.type,
          name: body.name,
          logoUrl: body.logo_url ?? null,
          minAmount: body.min_amount ?? null,
          maxAmount: body.max_amount ?? null,
          feePercent: body.fee_percent,
          feeFixed: body.fee_fixed,
          processingTimeHours: body.processing_time_hours,
          currencies: body.currencies,
          countries: body.countries,
          supportsDeposit: body.supports_deposit,
          supportsWithdrawal: body.supports_withdrawal,
          supportsTransfer: body.supports_transfer,
          isDefault: body.is_default,
          isActive: body.is_active,
          displayOrder: body.display_order,
          config: body.config,
        });
        await client.query('COMMIT');
        return row;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.payment_methods.create',
      resource: 'payment_method',
      resourceId: created.id,
      payload: { after: created },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return toView(created);
}

export async function deletePaymentMethod(req: Request, id: string) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const out = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => {
      const before = await repo.findPaymentMethodById(client, tenantId, id);
      if (!before) throw new NotFoundError('Payment method not found');
      const ok = await repo.deletePaymentMethod(client, tenantId, id);
      return { before, ok };
    }
  );

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.payment_methods.delete',
      resource: 'payment_method',
      resourceId: id,
      payload: { before: out.before },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return { ok: out.ok };
}

/**
 * Run a non-destructive connection check against the registered
 * provider. We don't call the provider's network API here (that would
 * introduce flaky tests + external dependencies); instead we verify
 * that the provider slug exists in the registry, that the required
 * credential keys are present in `config`, that the channel flags
 * match what the provider supports, and that limits are sane.
 *
 * Returns `{ ok, checks: [{ name, ok, detail }] }` so the admin UI
 * can render a checklist instead of a single boolean.
 */
export async function testPaymentMethod(
  req: Request,
  id: string,
  _body?: TestPaymentMethodInput
) {
  const scope = getAdminScope(req);
  const tenantId = requireScopedTenantId(scope);

  const row = await withTenantClient(
    { tenantId, bypassRls: scope.bypassRls },
    async (client) => repo.findPaymentMethodById(client, tenantId, id)
  );
  if (!row) throw new NotFoundError('Payment method not found');

  type Check = { name: string; ok: boolean; detail?: string };
  const checks: Check[] = [];

  const provider = providerRegistry.list().find(
    (p) => p.getProviderName() === row.provider_slug
  );
  checks.push({
    name: 'provider_registered',
    ok: Boolean(provider),
    detail: provider
      ? `Registered (${provider.getProviderName()})`
      : `Provider "${row.provider_slug}" is not in the registry; ` +
        `the gateway cannot route transactions until the backend ships ` +
        `a matching driver.`,
  });

  if (provider) {
    if (row.supports_deposit) {
      checks.push({
        name: 'supports_deposit',
        ok: provider.supportsDeposits(),
        detail: provider.supportsDeposits()
          ? 'Provider driver can handle deposits.'
          : 'Provider driver does NOT advertise deposits.',
      });
    }
    if (row.supports_withdrawal) {
      checks.push({
        name: 'supports_withdrawal',
        ok: provider.supportsWithdrawals(),
        detail: provider.supportsWithdrawals()
          ? 'Provider driver can handle withdrawals.'
          : 'Provider driver does NOT advertise withdrawals.',
      });
    }
    if (row.currencies.length > 0) {
      const known = provider.getSupportedCurrencies().map((c) => c.toUpperCase());
      const bad = row.currencies.filter(
        (c) => !known.includes(c.toUpperCase())
      );
      checks.push({
        name: 'currency_support',
        ok: bad.length === 0,
        detail:
          bad.length === 0
            ? `Provider supports: ${known.join(', ') || '(any)'}`
            : `Provider does NOT support: ${bad.join(', ')}`,
      });
    }
  }

  // Limits sanity.
  const minNum = row.min_amount === null ? null : Number(row.min_amount);
  const maxNum = row.max_amount === null ? null : Number(row.max_amount);
  if (minNum !== null && maxNum !== null) {
    checks.push({
      name: 'limits',
      ok: maxNum >= minNum,
      detail:
        maxNum >= minNum
          ? `min=${row.min_amount}, max=${row.max_amount}`
          : `Min (${row.min_amount}) is greater than max (${row.max_amount}).`,
    });
  }

  // Credential presence. We look for a handful of common config keys
  // and check that at least one credential block is configured if the
  // provider is anything but the offline Telebirr P2P stub.
  const cfg = row.config ?? {};
  const credentialKeys = ['api_key', 'secret', 'merchant_id', 'callback_url'];
  const presentCreds = credentialKeys.filter((k) => Boolean(cfg[k]));
  if (row.provider_slug !== 'telebirr_p2p') {
    checks.push({
      name: 'credentials',
      ok: presentCreds.length > 0,
      detail:
        presentCreds.length > 0
          ? `config has: ${presentCreds.join(', ')}`
          : 'No credential keys found in config. Provider may not authenticate.',
    });
  }

  const ok = checks.every((c) => c.ok);

  await tryAudit(
    {
      tenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.payment_methods.test',
      resource: 'payment_method',
      resourceId: id,
      payload: { ok, checks },
      ip: getIp(req),
      userAgent: getUa(req),
      status: ok ? 'success' : 'failure',
    },
    { bypassRls: true }
  );

  if (!ok && checks.length === 0) {
    throw new BadRequestError('No connection checks executed for this provider.');
  }
  return { ok, provider_slug: row.provider_slug, checks };
}

export async function seedDefaults(req: Request, body: SeedDefaultsInput) {
  const scope = getAdminScope(req);
  const requested = body.tenant_id ?? null;
  let targetTenantId: string;
  if (requested) {
    if (!scope.isSuperadmin && requested !== scope.tenantId) {
      // tenant_admin may only seed their own tenant.
      throw new NotFoundError('Tenant not found');
    }
    targetTenantId = requested;
  } else {
    targetTenantId = requireScopedTenantId(scope);
  }

  const result = await seedTelebirrP2PForTenant(targetTenantId);

  await tryAudit(
    {
      tenantId: targetTenantId,
      actorId: scope.actorId,
      actorType: scope.actorType,
      action: 'admin.payment_methods.seed_defaults',
      resource: 'payment_method',
      resourceId: result.provider_slug,
      payload: { inserted: result.inserted },
      ip: getIp(req),
      userAgent: getUa(req),
      status: 'success',
    },
    { bypassRls: true }
  );

  return { tenant_id: targetTenantId, ...result };
}
