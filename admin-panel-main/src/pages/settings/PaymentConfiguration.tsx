import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { TabGroup } from '../../components/TabGroup';
import {
  CreditCard,
  Plus,
  Save,
  Pencil,
  Star,
  StarOff,
  Trash2,
  ZapOff,
  Activity,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import * as paymentMethodsApi from '../../lib/api/payment-methods';
import * as settingsApi from '../../lib/api/settings';
import { useAuthStore } from '../../store/auth';

/* -------------------------------------------------------------------------- */
/* Section 21 — Payment Configuration                                         */
/*                                                                            */
/*   Tab 1: Manage Payment Methods   — toggle deposit/withdrawal/             */
/*                                     transfer/default flags                */
/*   Tab 2: View Payment Configurations — read-only summary with callback,   */
/*                                         limits, status                    */
/*   Tab 3: Manage Payment Configurations — add/edit gateway (credentials,    */
/*                                          callback URL, min/max), and      */
/*                                          run POST /:id/test               */
/*   Tab 4 (kept): Limits & Rules — global payment limits at                  */
/*                                  /api/admin/settings/payment              */
/* -------------------------------------------------------------------------- */

const defaultLimits: settingsApi.PaymentConfig = {
  min_deposit_amount: 10,
  max_deposit_amount: 50000,
  min_withdrawal_amount: 50,
  max_withdrawal_amount: 50000,
  withdrawal_processing_hours: 24,
  require_id_verification_above: 10000,
};

type EditableForm = paymentMethodsApi.CreatePaymentMethodInput & {
  id?: string;
  // Credentials surfaced in a friendly form; we copy them into `config`
  // on save so the backend stores them all under the JSONB column.
  callback_url?: string;
  api_key?: string;
  api_secret?: string;
  merchant_id?: string;
};

const blankForm: EditableForm = {
  provider_slug: '',
  name: '',
  type: 'p2p',
  logo_url: '',
  min_amount: '0',
  max_amount: '50000',
  currencies: ['ETB'],
  countries: ['ET'],
  supports_deposit: true,
  supports_withdrawal: false,
  supports_transfer: false,
  is_default: false,
  is_active: true,
  callback_url: '',
  api_key: '',
  api_secret: '',
  merchant_id: '',
};

function rowToForm(row: paymentMethodsApi.PaymentMethodRow): EditableForm {
  const cfg = (row.config ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    provider_slug: row.provider_slug,
    name: row.name,
    type: row.type,
    logo_url: row.logo_url ?? '',
    min_amount: row.min_amount ?? '',
    max_amount: row.max_amount ?? '',
    currencies: row.currencies ?? ['ETB'],
    countries: row.countries ?? ['ET'],
    supports_deposit: row.supports_deposit,
    supports_withdrawal: row.supports_withdrawal,
    supports_transfer: row.supports_transfer,
    is_default: row.is_default,
    is_active: row.is_active,
    callback_url:
      typeof cfg.callback_url === 'string' ? (cfg.callback_url as string) : '',
    api_key: typeof cfg.api_key === 'string' ? (cfg.api_key as string) : '',
    api_secret:
      typeof cfg.api_secret === 'string' ? (cfg.api_secret as string) : '',
    merchant_id:
      typeof cfg.merchant_id === 'string' ? (cfg.merchant_id as string) : '',
  };
}

function formToInput(form: EditableForm): paymentMethodsApi.CreatePaymentMethodInput {
  const config: Record<string, unknown> = {};
  if (form.callback_url) config.callback_url = form.callback_url;
  if (form.api_key) config.api_key = form.api_key;
  if (form.api_secret) config.api_secret = form.api_secret;
  if (form.merchant_id) config.merchant_id = form.merchant_id;
  return {
    provider_slug: form.provider_slug,
    name: form.name,
    type: form.type,
    logo_url: form.logo_url || null,
    min_amount: form.min_amount || null,
    max_amount: form.max_amount || null,
    currencies: form.currencies?.length ? form.currencies : ['ETB'],
    countries: form.countries?.length ? form.countries : ['ET'],
    supports_deposit: Boolean(form.supports_deposit),
    supports_withdrawal: Boolean(form.supports_withdrawal),
    supports_transfer: Boolean(form.supports_transfer),
    is_default: Boolean(form.is_default),
    is_active: Boolean(form.is_active),
    config,
  };
}

export function PaymentConfiguration() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('methods');
  const [methods, setMethods] = useState<paymentMethodsApi.PaymentMethodRow[]>([]);
  const [providers, setProviders] = useState<paymentMethodsApi.ProviderRegistryRow[]>(
    []
  );
  const [limits, setLimits] = useState<settingsApi.PaymentConfig>(defaultLimits);
  const [loading, setLoading] = useState(true);
  const [savingLimits, setSavingLimits] = useState(false);

  /* Tab 3 edit-form state */
  const [showEditor, setShowEditor] = useState(false);
  const [editForm, setEditForm] = useState<EditableForm>(blankForm);
  const [editorBusy, setEditorBusy] = useState(false);

  /* Tab 3 test-result display */
  const [testResult, setTestResult] =
    useState<paymentMethodsApi.TestResult | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const load = async () => {
    if (!isAuth) return;
    setLoading(true);
    try {
      const [methodsRes, providersRes, limitsRes] = await Promise.all([
        paymentMethodsApi.listPaymentMethods(),
        paymentMethodsApi.listPaymentProviders().catch(() => ({ items: [] })),
        settingsApi
          .getPaymentConfig()
          .catch(() => ({} as settingsApi.PaymentConfig)),
      ]);
      setMethods(methodsRes.items ?? []);
      setProviders(providersRes.items ?? []);
      setLimits({ ...defaultLimits, ...(limitsRes ?? {}) });
    } catch (err) {
      toast(
        `Failed to load payment settings: ${(err as Error)?.message ?? err}`,
        'error'
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuth]);

  const saveLimits = async () => {
    setSavingLimits(true);
    try {
      await settingsApi.updatePaymentConfig(limits);
      toast('Payment limits saved.');
    } catch (err) {
      toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSavingLimits(false);
    }
  };

  /* ------------------------------------------------------------------------ */
  /* Tab 1 — flag toggles                                                     */
  /* ------------------------------------------------------------------------ */

  const patchFlags = async (
    row: paymentMethodsApi.PaymentMethodRow,
    patch: paymentMethodsApi.UpdatePaymentMethodInput
  ) => {
    try {
      const updated = await paymentMethodsApi.patchPaymentMethod(row.id, patch);
      setMethods((prev) =>
        prev.map((m) => {
          if (m.id === updated.id) return updated;
          // is_default is unique per tenant — if we just set it on this row,
          // demote everyone else locally to keep the table in sync.
          if (patch.is_default === true) {
            return { ...m, is_default: false };
          }
          return m;
        })
      );
      toast('Updated.');
    } catch (err) {
      toast(`Update failed: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  /* ------------------------------------------------------------------------ */
  /* Tab 3 — create / edit / delete                                            */
  /* ------------------------------------------------------------------------ */

  const openCreate = () => {
    setEditForm(blankForm);
    setTestResult(null);
    setShowEditor(true);
  };
  const openEdit = (row: paymentMethodsApi.PaymentMethodRow) => {
    setEditForm(rowToForm(row));
    setTestResult(null);
    setShowEditor(true);
  };
  const closeEditor = () => setShowEditor(false);

  const saveEditor = async () => {
    setEditorBusy(true);
    try {
      const payload = formToInput(editForm);
      const out = editForm.id
        ? await paymentMethodsApi.updatePaymentMethod(editForm.id, payload)
        : await paymentMethodsApi.createPaymentMethod(payload);
      setMethods((prev) => {
        const idx = prev.findIndex((m) => m.id === out.id);
        if (idx === -1) return [out, ...prev];
        const copy = [...prev];
        copy[idx] = out;
        return copy;
      });
      toast(editForm.id ? 'Gateway updated.' : 'Gateway created.');
      setShowEditor(false);
    } catch (err) {
      toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setEditorBusy(false);
    }
  };

  const removeMethod = async (row: paymentMethodsApi.PaymentMethodRow) => {
    if (!confirm(`Delete payment method "${row.name}"? This cannot be undone.`)) {
      return;
    }
    try {
      await paymentMethodsApi.deletePaymentMethod(row.id);
      setMethods((prev) => prev.filter((m) => m.id !== row.id));
      toast('Deleted.');
    } catch (err) {
      toast(`Delete failed: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  const runTest = async (row: paymentMethodsApi.PaymentMethodRow) => {
    setTestingId(row.id);
    setTestResult(null);
    try {
      const out = await paymentMethodsApi.testPaymentMethod(row.id);
      setTestResult(out);
      toast(out.ok ? 'Connection check passed.' : 'Connection check failed.', out.ok ? 'success' : 'error');
    } catch (err) {
      toast(`Test failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setTestingId(null);
    }
  };

  /* ------------------------------------------------------------------------ */
  /* UI tabs                                                                   */
  /* ------------------------------------------------------------------------ */

  const tabs = [
    { id: 'methods', label: 'Manage Payment Methods' },
    { id: 'view-configs', label: 'View Payment Configurations' },
    { id: 'manage-configs', label: 'Manage Payment Configurations' },
    { id: 'limits', label: 'Limits & Rules' },
  ];

  const viewConfigs = useMemo(
    () =>
      methods.map((m) => ({
        id: m.id,
        providerName: m.name,
        provider_slug: m.provider_slug,
        mode: m.is_active ? 'Live' : 'Test',
        status: m.is_active ? 'Active' : 'Inactive',
        callbackUrl: m.callback_url ?? '—',
        minAmount: m.min_amount ?? '—',
        maxAmount: m.max_amount ?? '—',
        updatedAt: m.updated_at,
      })),
    [methods]
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <CreditCard className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">
            Payment Configuration
          </h1>
        </div>
        {activeTab === 'manage-configs' && (
          <button
            onClick={openCreate}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <Plus className="h-4 w-4 mr-2" />
            Add Configuration
          </button>
        )}
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* ------------------------------------------------------------------ */}
      {/* Tab 1 — Manage Payment Methods (flag toggles)                      */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === 'methods' && (
        <div className="bg-white rounded-lg shadow overflow-hidden">
          <div className="px-4 py-3 text-xs text-gray-500 border-b">
            Mapped to <code>GET /api/admin/settings/payment/methods</code> +{' '}
            <code>PATCH /:id</code>. Toggles flip <code>supports_deposit</code>,{' '}
            <code>supports_withdrawal</code>, <code>supports_transfer</code>,{' '}
            <code>is_default</code>, and <code>is_active</code> in real time.
          </div>
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <Th>Method</Th>
                <Th>Channel</Th>
                <Th>Currency</Th>
                <Th>Deposit</Th>
                <Th>Withdrawal</Th>
                <Th>Transfer</Th>
                <Th>Default</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {methods.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">{m.name}</div>
                    <div className="text-xs text-gray-500 font-mono">
                      {m.provider_slug}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {m.channels.join(', ') || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {m.currencies.join(', ') || '—'}
                  </td>
                  <FlagCell
                    checked={m.supports_deposit}
                    onChange={(v) =>
                      void patchFlags(m, { supports_deposit: v })
                    }
                  />
                  <FlagCell
                    checked={m.supports_withdrawal}
                    onChange={(v) =>
                      void patchFlags(m, { supports_withdrawal: v })
                    }
                  />
                  <FlagCell
                    checked={m.supports_transfer}
                    onChange={(v) =>
                      void patchFlags(m, { supports_transfer: v })
                    }
                  />
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        void patchFlags(m, { is_default: !m.is_default })
                      }
                      title={m.is_default ? 'Default gateway' : 'Make default'}
                      className={
                        m.is_default
                          ? 'text-yellow-500'
                          : 'text-gray-400 hover:text-yellow-500'
                      }
                    >
                      {m.is_default ? (
                        <Star className="h-5 w-5 fill-current" />
                      ) : (
                        <StarOff className="h-5 w-5" />
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={m.is_active}
                        onChange={(e) =>
                          void patchFlags(m, { is_active: e.target.checked })
                        }
                      />
                      <span className="ml-2 text-xs">
                        {m.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </label>
                  </td>
                </tr>
              ))}
              {methods.length === 0 && !loading && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-500">
                    No payment methods configured. Open “Manage Payment
                    Configurations” to add one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Tab 2 — View Payment Configurations (read-only summary)           */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === 'view-configs' && (
        <div className="bg-white rounded-lg shadow">
          <DataTable
            columns={[
              { header: 'Provider Name', accessor: 'providerName' as const },
              { header: 'Provider Slug', accessor: 'provider_slug' as const },
              { header: 'Mode', accessor: 'mode' as const },
              { header: 'Status', accessor: 'status' as const },
              { header: 'Callback URL', accessor: 'callbackUrl' as const },
              { header: 'Min Amount', accessor: 'minAmount' as const },
              { header: 'Max Amount', accessor: 'maxAmount' as const },
              { header: 'Updated', accessor: 'updatedAt' as const },
            ]}
            data={viewConfigs}
          />
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Tab 3 — Manage Payment Configurations (CRUD + test)               */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === 'manage-configs' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <Th>Provider</Th>
                  <Th>Slug</Th>
                  <Th>Callback URL</Th>
                  <Th>Min / Max</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {methods.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {m.name}
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-600">
                      {m.provider_slug}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 truncate max-w-[280px]">
                      {m.callback_url ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {(m.min_amount ?? '—') + ' / ' + (m.max_amount ?? '—')}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span
                        className={
                          m.is_active
                            ? 'text-green-600 font-medium'
                            : 'text-gray-500'
                        }
                      >
                        {m.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3 space-x-2">
                      <button
                        onClick={() => openEdit(m)}
                        className="text-blue-600 hover:text-blue-800"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4 inline" />
                      </button>
                      <button
                        onClick={() => void runTest(m)}
                        disabled={testingId === m.id}
                        className="text-purple-600 hover:text-purple-800 disabled:text-gray-300"
                        title="Test connection"
                      >
                        {testingId === m.id ? (
                          <ZapOff className="h-4 w-4 inline animate-pulse" />
                        ) : (
                          <Activity className="h-4 w-4 inline" />
                        )}
                      </button>
                      <button
                        onClick={() => void removeMethod(m)}
                        className="text-red-600 hover:text-red-800"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4 inline" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {testResult && (
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {testResult.ok ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-5 w-5 text-red-600" />
                  )}
                  <h3 className="text-sm font-semibold text-gray-800">
                    Test result: {testResult.provider_slug} —{' '}
                    {testResult.ok ? 'PASS' : 'FAIL'}
                  </h3>
                </div>
                <button
                  onClick={() => setTestResult(null)}
                  className="text-xs text-gray-500 hover:text-gray-800"
                >
                  Dismiss
                </button>
              </div>
              <ul className="text-sm space-y-1">
                {testResult.checks.map((c) => (
                  <li key={c.name} className="flex items-start gap-2">
                    {c.ok ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 mt-0.5" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5" />
                    )}
                    <div>
                      <div className="font-mono text-xs">{c.name}</div>
                      {c.detail && (
                        <div className="text-xs text-gray-600">{c.detail}</div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Tab 4 — Limits & Rules                                             */}
      {/* ------------------------------------------------------------------ */}
      {activeTab === 'limits' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <p className="text-xs text-gray-500">
            Mapped to <code>GET/PUT /api/admin/settings/payment</code>. These
            limits are read by deposit + withdrawal flows on every transaction.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <NumField label="Min deposit (ETB)" value={limits.min_deposit_amount} onChange={(v) => setLimits((p) => ({ ...p, min_deposit_amount: v }))} />
            <NumField label="Max deposit (ETB)" value={limits.max_deposit_amount} onChange={(v) => setLimits((p) => ({ ...p, max_deposit_amount: v }))} />
            <NumField label="Min withdrawal (ETB)" value={limits.min_withdrawal_amount} onChange={(v) => setLimits((p) => ({ ...p, min_withdrawal_amount: v }))} />
            <NumField label="Max withdrawal (ETB)" value={limits.max_withdrawal_amount} onChange={(v) => setLimits((p) => ({ ...p, max_withdrawal_amount: v }))} />
            <NumField label="Withdrawal processing (hours)" value={limits.withdrawal_processing_hours} onChange={(v) => setLimits((p) => ({ ...p, withdrawal_processing_hours: v }))} />
            <NumField label="Require ID verification above (ETB)" value={limits.require_id_verification_above} onChange={(v) => setLimits((p) => ({ ...p, require_id_verification_above: v }))} />
          </div>
          <div className="flex justify-end">
            <button
              onClick={saveLimits}
              disabled={savingLimits}
              className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
            >
              <Save className="h-4 w-4 mr-2" />
              {savingLimits ? 'Saving...' : 'Save Limits'}
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div className="text-sm text-gray-500">Loading payment configuration…</div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Editor modal (Tab 3 add / edit)                                    */}
      {/* ------------------------------------------------------------------ */}
      {showEditor && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
          role="dialog"
        >
          <div className="bg-white rounded-lg w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {editForm.id ? 'Edit Gateway' : 'Add Gateway'}
                </h2>
                <button
                  onClick={closeEditor}
                  className="text-gray-500 hover:text-gray-800"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                <label className="space-y-1">
                  <span className="text-gray-700">Provider slug</span>
                  <input
                    list="provider-slug-options"
                    value={editForm.provider_slug}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        provider_slug: e.target.value.trim(),
                      }))
                    }
                    disabled={Boolean(editForm.id)}
                    placeholder="telebirr_p2p, chapa, mpesa…"
                    className="w-full rounded-md border-gray-300 disabled:bg-gray-100 font-mono"
                  />
                  <datalist id="provider-slug-options">
                    {providers.map((p) => (
                      <option key={p.slug} value={p.slug}>
                        {p.slug}
                      </option>
                    ))}
                  </datalist>
                  <span className="text-[11px] text-gray-500">
                    Must match a driver registered in the backend
                    <code> providerRegistry</code>.
                  </span>
                </label>
                <label className="space-y-1">
                  <span className="text-gray-700">Display name</span>
                  <input
                    value={editForm.name}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, name: e.target.value }))
                    }
                    placeholder="Telebirr Mobile Money"
                    className="w-full rounded-md border-gray-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-gray-700">Logo URL</span>
                  <input
                    value={editForm.logo_url ?? ''}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, logo_url: e.target.value }))
                    }
                    placeholder="https://…"
                    className="w-full rounded-md border-gray-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-gray-700">Type</span>
                  <input
                    value={editForm.type ?? 'p2p'}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, type: e.target.value }))
                    }
                    placeholder="p2p, gateway, bank…"
                    className="w-full rounded-md border-gray-300 font-mono"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-gray-700">Min amount</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={editForm.min_amount ?? ''}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, min_amount: e.target.value }))
                    }
                    className="w-full rounded-md border-gray-300"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-gray-700">Max amount</span>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    value={editForm.max_amount ?? ''}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, max_amount: e.target.value }))
                    }
                    className="w-full rounded-md border-gray-300"
                  />
                </label>

                <label className="md:col-span-2 space-y-1">
                  <span className="text-gray-700">Callback URL</span>
                  <input
                    value={editForm.callback_url ?? ''}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        callback_url: e.target.value,
                      }))
                    }
                    placeholder="https://api.example.com/payments/webhook"
                    className="w-full rounded-md border-gray-300 font-mono text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-gray-700">API key</span>
                  <input
                    type="password"
                    value={editForm.api_key ?? ''}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, api_key: e.target.value }))
                    }
                    placeholder="(set to rotate)"
                    className="w-full rounded-md border-gray-300 font-mono text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="text-gray-700">API secret</span>
                  <input
                    type="password"
                    value={editForm.api_secret ?? ''}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, api_secret: e.target.value }))
                    }
                    placeholder="(set to rotate)"
                    className="w-full rounded-md border-gray-300 font-mono text-xs"
                  />
                </label>
                <label className="space-y-1 md:col-span-2">
                  <span className="text-gray-700">Merchant ID</span>
                  <input
                    value={editForm.merchant_id ?? ''}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        merchant_id: e.target.value,
                      }))
                    }
                    className="w-full rounded-md border-gray-300 font-mono text-xs"
                  />
                </label>

                <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-5 gap-3 pt-2">
                  <CheckboxField
                    label="Deposit"
                    checked={Boolean(editForm.supports_deposit)}
                    onChange={(v) =>
                      setEditForm((f) => ({ ...f, supports_deposit: v }))
                    }
                  />
                  <CheckboxField
                    label="Withdrawal"
                    checked={Boolean(editForm.supports_withdrawal)}
                    onChange={(v) =>
                      setEditForm((f) => ({ ...f, supports_withdrawal: v }))
                    }
                  />
                  <CheckboxField
                    label="Transfer"
                    checked={Boolean(editForm.supports_transfer)}
                    onChange={(v) =>
                      setEditForm((f) => ({ ...f, supports_transfer: v }))
                    }
                  />
                  <CheckboxField
                    label="Default"
                    checked={Boolean(editForm.is_default)}
                    onChange={(v) =>
                      setEditForm((f) => ({ ...f, is_default: v }))
                    }
                  />
                  <CheckboxField
                    label="Active"
                    checked={Boolean(editForm.is_active)}
                    onChange={(v) =>
                      setEditForm((f) => ({ ...f, is_active: v }))
                    }
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t">
                <button
                  onClick={closeEditor}
                  className="px-4 py-2 rounded-md border border-gray-300"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveEditor()}
                  disabled={editorBusy}
                  className="px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
                >
                  {editorBusy ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small UI helpers                                                            */
/* -------------------------------------------------------------------------- */

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
      {children}
    </th>
  );
}

function FlagCell({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <td className="px-4 py-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </td>
  );
}

function CheckboxField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function NumField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="space-y-1">
      <span className="text-gray-700">{label}</span>
      <input
        type="number"
        min={0}
        value={value ?? 0}
        onChange={(e) => onChange(Number(e.target.value || 0))}
        className="w-full rounded-md border-gray-300"
      />
    </label>
  );
}
