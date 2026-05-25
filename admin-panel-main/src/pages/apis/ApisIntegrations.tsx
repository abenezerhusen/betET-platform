import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { TabGroup } from '../../components/TabGroup';
import { Plug, FileText, Eye, EyeOff, CreditCard, Activity, Gamepad2, Plus } from 'lucide-react';
import * as integrationsApi from '../../lib/api/integrations';
import { toast } from '../../lib/toast';
import { useAuthStore } from '../../store/auth';

interface ApiConfig {
  id: string;
  name: string;
  category: 'payment' | 'odds' | 'game';
  enabled: boolean;
  env: 'sandbox' | 'live';
  apiKey: string;
  description: string;
  company?: string;
  baseUrl?: string;
  secret?: string;
  webhookUrl?: string;
  authType?: 'api-key' | 'bearer' | 'oauth2' | 'basic';
  contactEmail?: string;
  agreementRef?: string;
  provider?: string;
  secretKeys?: string[];
  lastHealthAt?: string | null;
}

const tabs = [
  { id: 'payment', label: 'Payment APIs' },
  { id: 'odds', label: 'Odds Providers' },
  { id: 'game', label: 'Game APIs' },
];

const categoryIcon = { payment: CreditCard, odds: Activity, game: Gamepad2 };

const kindToCategory = (kind: integrationsApi.IntegrationRow['kind']): ApiConfig['category'] => {
  if (kind === 'payment') return 'payment';
  if (kind === 'game_provider') return 'game';
  return 'odds';
};

const categoryToKind = (
  category: ApiConfig['category']
): integrationsApi.IntegrationRow['kind'] => {
  if (category === 'payment') return 'payment';
  if (category === 'game') return 'game_provider';
  return 'odds';
};

const getStringConfig = (
  config: Record<string, unknown> | undefined,
  key: string,
  fallback = ''
) => {
  const value = config?.[key];
  return typeof value === 'string' ? value : fallback;
};

function mapIntegration(row: integrationsApi.IntegrationRow): ApiConfig {
  const config = row.config ?? {};
  return {
    id: row.id,
    name: row.name,
    category: kindToCategory(row.kind),
    enabled: row.status === 'active',
    env: getStringConfig(config, 'env') === 'live' ? 'live' : 'sandbox',
    apiKey: row.configured_secret_keys?.includes('api_key') ? '•••••••• (stored)' : '',
    description: getStringConfig(config, 'description'),
    company: getStringConfig(config, 'company', row.provider),
    baseUrl: row.base_url ?? '',
    webhookUrl: getStringConfig(config, 'webhook_url'),
    authType: (getStringConfig(config, 'auth_type', 'api-key') as ApiConfig['authType']) ?? 'api-key',
    contactEmail: getStringConfig(config, 'contact_email'),
    agreementRef: getStringConfig(config, 'agreement_ref'),
    provider: row.provider,
    secretKeys: row.configured_secret_keys ?? [],
    lastHealthAt: row.last_health_at ?? null,
  };
}

export function ApisIntegrations() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [apis, setApis] = useState<ApiConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'payment' | 'odds' | 'game'>('payment');
  const [showKeys, setShowKeys] = useState<Record<string, boolean>>({});
  const [logsFor, setLogsFor] = useState<ApiConfig | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const emptyForm: Omit<ApiConfig, 'id'> = {
    name: '',
    category: 'payment',
    enabled: false,
    env: 'sandbox',
    apiKey: '',
    description: '',
    company: '',
    baseUrl: '',
    secret: '',
    webhookUrl: '',
    authType: 'api-key',
    contactEmail: '',
    agreementRef: '',
  };
  const [form, setForm] = useState<Omit<ApiConfig, 'id'>>(emptyForm);

  const updateForm = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const load = useCallback(() => {
    if (!isAuth) return;
    setLoading(true);
    integrationsApi
      .listIntegrations()
      .then((items) => setApis(items.map(mapIntegration)))
      .catch((err: Error) => toast(`Failed to load integrations: ${err.message ?? err}`, 'error'))
      .finally(() => setLoading(false));
  }, [isAuth]);

  useEffect(() => {
    load();
  }, [load]);

  const toConfig = (api: Partial<ApiConfig>) => ({
    env: api.env ?? 'sandbox',
    description: api.description ?? '',
    company: api.company ?? '',
    webhook_url: api.webhookUrl ?? '',
    auth_type: api.authType ?? 'api-key',
    contact_email: api.contactEmail ?? '',
    agreement_ref: api.agreementRef ?? '',
  });

  const handleAddApi = async () => {
    if (!form.name.trim() || !form.company?.trim()) return;
    try {
      const provider = form.provider?.trim() || form.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      await integrationsApi.createIntegration({
        name: form.name.trim(),
        kind: categoryToKind(form.category),
        provider,
        base_url: form.baseUrl?.trim() || undefined,
        status: form.enabled ? 'active' : 'inactive',
        secrets: {
          ...(form.apiKey ? { api_key: form.apiKey } : {}),
          ...(form.secret ? { secret: form.secret } : {}),
        },
        config: toConfig(form),
      });
      toast('Integration saved.');
      setActiveTab(form.category);
      setForm(emptyForm);
      setShowAddModal(false);
      load();
    } catch (err) {
      toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  const updateApi = async (id: string, patch: Partial<ApiConfig>) => {
    const current = apis.find((a) => a.id === id);
    if (!current) return;
    setSavingId(id);
    try {
      // PATCH /api/admin/integrations/:id for general field updates.
      await integrationsApi.patchIntegration(id, {
        name: patch.name ?? current.name,
        kind: categoryToKind(patch.category ?? current.category),
        provider:
          patch.provider ??
          current.provider ??
          current.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        base_url: patch.baseUrl ?? current.baseUrl,
        enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
        config: toConfig({ ...current, ...patch }),
      });
      // POST /api/admin/integrations/:id/key for secret rotation — keeps
      // raw API keys off the general PATCH path so they never travel
      // alongside non-secret config fields.
      if (patch.apiKey && !patch.apiKey.includes('stored')) {
        await integrationsApi.updateIntegrationKey(id, { api_key: patch.apiKey });
      }
      setApis((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
      toast('Integration updated.');
    } catch (err) {
      toast(`Update failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSavingId(null);
    }
  };

  const toggleEnabled = (id: string) => {
    const api = apis.find((a) => a.id === id);
    if (api) void updateApi(id, { enabled: !api.enabled });
  };

  const setEnv = (id: string, env: 'sandbox' | 'live') => void updateApi(id, { env });

  const setKey = (id: string, apiKey: string) =>
    setApis((prev) => prev.map((a) => (a.id === id ? { ...a, apiKey } : a)));

  const persistKey = (id: string) => {
    const api = apis.find((a) => a.id === id);
    if (!api || !api.apiKey || api.apiKey.includes('stored')) return;
    void updateApi(id, { apiKey: api.apiKey });
  };

  const [testingId, setTestingId] = useState<string | null>(null);
  const testConnection = async (api: ApiConfig) => {
    if (testingId) return;
    setTestingId(api.id);
    try {
      const r = await integrationsApi.testIntegration(api.id);
      if (r.ok) {
        toast(`${api.name}: connected (${r.detail ?? r.probe_status}).`);
      } else {
        toast(
          `${api.name}: ${r.probe_status}${r.detail ? ` — ${r.detail}` : ''}`,
          'error'
        );
      }
      load();
    } catch (err) {
      toast(`Test failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setTestingId(null);
    }
  };

  const filtered = useMemo(() => apis.filter((a) => a.category === activeTab), [apis, activeTab]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Plug className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">APIs & Integrations</h1>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 shadow-sm"
        >
          <Plus size={16} className="mr-2" />
          Add New API
        </button>
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as 'payment' | 'odds' | 'game')}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {loading && filtered.length === 0 && (
          <div className="col-span-full bg-white rounded-lg shadow p-8 text-center text-sm text-gray-500">
            Loading integrations…
          </div>
        )}
        {!loading && filtered.length === 0 && (
          <div className="col-span-full bg-white rounded-lg shadow p-8 text-center text-sm text-gray-500">
            No integrations configured for this category.
          </div>
        )}
        {filtered.map((api) => {
          const Icon = categoryIcon[api.category];
          const keyVisible = !!showKeys[api.id];
          return (
            <div key={api.id} className="bg-white rounded-lg shadow">
              <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <div className={`p-2 rounded-lg ${api.enabled ? 'bg-blue-50' : 'bg-gray-100'}`}>
                    <Icon className={`h-5 w-5 ${api.enabled ? 'text-blue-600' : 'text-gray-400'}`} />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{api.name}</h3>
                    <p className="text-xs text-gray-500">{api.description}</p>
                  </div>
                </div>
                <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={api.enabled}
                    onChange={() => toggleEnabled(api.id)}
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                </label>
              </div>
              <div className="p-5 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">API Key</label>
                  <div className="flex items-center space-x-2">
                    <input
                      type={keyVisible ? 'text' : 'password'}
                      value={api.apiKey}
                      onChange={(e) => setKey(api.id, e.target.value)}
                      onBlur={() => persistKey(api.id)}
                      placeholder={
                        api.secretKeys?.length
                          ? `Stored: ${api.secretKeys.join(', ')}`
                          : 'Paste API key to store securely'
                      }
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm font-mono"
                    />
                    <button
                      onClick={() => setShowKeys({ ...showKeys, [api.id]: !keyVisible })}
                      className="p-2 border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      {keyVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Environment</label>
                  <div className="inline-flex rounded-md shadow-sm" role="group">
                    <button
                      onClick={() => setEnv(api.id, 'sandbox')}
                      className={`px-4 py-1.5 text-sm font-medium border rounded-l-md ${
                        api.env === 'sandbox'
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      Sandbox
                    </button>
                    <button
                      onClick={() => setEnv(api.id, 'live')}
                      className={`px-4 py-1.5 text-sm font-medium border-t border-b border-r rounded-r-md ${
                        api.env === 'live'
                          ? 'bg-green-600 text-white border-green-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      Live
                    </button>
                  </div>
                </div>
              </div>
              <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between gap-2 flex-wrap">
                <span
                  className={`inline-flex items-center text-xs font-medium ${
                    api.enabled ? 'text-green-700' : 'text-gray-500'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full mr-1.5 ${api.enabled ? 'bg-green-500' : 'bg-gray-400'}`}></span>
                  {savingId === api.id ? 'Saving…' : api.enabled ? 'Connected' : 'Disabled'}
                  {api.lastHealthAt && (
                    <span className="ml-2 text-gray-400">
                      (tested {new Date(api.lastHealthAt).toLocaleString()})
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => void testConnection(api)}
                    disabled={testingId === api.id}
                    className="inline-flex items-center text-xs font-medium text-purple-600 hover:text-purple-800 disabled:opacity-60"
                  >
                    {testingId === api.id ? 'Testing…' : 'Test connection'}
                  </button>
                  <button
                    onClick={() => setLogsFor(api)}
                    className="inline-flex items-center text-xs font-medium text-blue-600 hover:text-blue-800"
                  >
                    <FileText size={12} className="mr-1" /> View Logs
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 sticky top-0 bg-white">
              <div>
                <h3 className="text-lg font-medium text-gray-900">Add New API / Partner</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Register a new company or provider you have an agreement with.
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setForm(emptyForm);
                }}
                className="text-gray-400 hover:text-gray-600 text-xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Partner / API Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={(e) => updateForm('name', e.target.value)}
                    placeholder="e.g. CBE Birr Gateway"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Company / Vendor <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={(e) => updateForm('company', e.target.value)}
                    placeholder="e.g. Commercial Bank of Ethiopia"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) =>
                      updateForm('category', e.target.value as 'payment' | 'odds' | 'game')
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="payment">Payment API</option>
                    <option value="odds">Odds Provider</option>
                    <option value="game">Game API</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Auth Type</label>
                  <select
                    value={form.authType}
                    onChange={(e) =>
                      updateForm(
                        'authType',
                        e.target.value as 'api-key' | 'bearer' | 'oauth2' | 'basic'
                      )
                    }
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="api-key">API Key</option>
                    <option value="bearer">Bearer Token</option>
                    <option value="oauth2">OAuth 2.0</option>
                    <option value="basic">Basic Auth</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateForm('description', e.target.value)}
                  rows={2}
                  placeholder="Short description of what this integration does."
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Base URL</label>
                <input
                  type="text"
                  value={form.baseUrl}
                  onChange={(e) => updateForm('baseUrl', e.target.value)}
                  placeholder="https://api.partner.com/v1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">API Key</label>
                  <input
                    type="text"
                    value={form.apiKey}
                    onChange={(e) => updateForm('apiKey', e.target.value)}
                    placeholder="Paste API key"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Secret / Private Key
                  </label>
                  <input
                    type="password"
                    value={form.secret}
                    onChange={(e) => updateForm('secret', e.target.value)}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Webhook URL</label>
                <input
                  type="text"
                  value={form.webhookUrl}
                  onChange={(e) => updateForm('webhookUrl', e.target.value)}
                  placeholder="https://yourdomain.com/webhooks/partner"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Contact Email
                  </label>
                  <input
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => updateForm('contactEmail', e.target.value)}
                    placeholder="partner@company.com"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Agreement Reference
                  </label>
                  <input
                    type="text"
                    value={form.agreementRef}
                    onChange={(e) => updateForm('agreementRef', e.target.value)}
                    placeholder="e.g. AGR-2025-0042"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Environment</label>
                  <div className="inline-flex rounded-md shadow-sm" role="group">
                    <button
                      type="button"
                      onClick={() => updateForm('env', 'sandbox')}
                      className={`px-4 py-1.5 text-sm font-medium border rounded-l-md ${
                        form.env === 'sandbox'
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      Sandbox
                    </button>
                    <button
                      type="button"
                      onClick={() => updateForm('env', 'live')}
                      className={`px-4 py-1.5 text-sm font-medium border-t border-b border-r rounded-r-md ${
                        form.env === 'live'
                          ? 'bg-green-600 text-white border-green-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      Live
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
                  <label className="inline-flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only peer"
                      checked={form.enabled}
                      onChange={() => updateForm('enabled', !form.enabled)}
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] relative after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    <span className="text-sm text-gray-700">
                      {form.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </label>
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg sticky bottom-0">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setForm(emptyForm);
                }}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleAddApi}
                disabled={!form.name.trim() || !form.company?.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Save API
              </button>
            </div>
          </div>
        </div>
      )}

      {logsFor && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">{logsFor.name} — Logs</h3>
              <button onClick={() => setLogsFor(null)} className="text-gray-400 hover:text-gray-600 text-xl">
                ×
              </button>
            </div>
            <div className="p-6">
              <div className="bg-gray-900 text-gray-100 rounded-lg p-4 font-mono text-xs max-h-96 overflow-y-auto space-y-1">
                <p>
                  <span className="text-gray-400">provider</span>{' '}
                  <span className="text-green-400">{logsFor.provider ?? logsFor.name}</span>
                </p>
                <p>
                  <span className="text-gray-400">base_url</span>{' '}
                  <span className="text-green-400">{logsFor.baseUrl || 'not configured'}</span>
                </p>
                <p>
                  <span className="text-gray-400">last_health_at</span>{' '}
                  <span className="text-green-400">{logsFor.lastHealthAt ?? 'not pinged yet'}</span>
                </p>
                <p>
                  <span className="text-gray-400">secrets</span>{' '}
                  <span className="text-green-400">{logsFor.secretKeys?.join(', ') || 'none configured'}</span>
                </p>
              </div>
            </div>
            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setLogsFor(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
