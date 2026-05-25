import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Code2,
  Plus,
  Trash2,
  RefreshCw,
  X,
  Globe,
  ServerCog,
  ShieldCheck,
  Power,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import { useAuthStore } from '../../store/auth';
import * as iframeApi from '../../lib/api/iframe';
import * as rtpApi from '../../lib/api/rtp';

type Mode = 'outbound' | 'inbound' | 'legacy';

interface OutboundForm {
  client_id: string;
  game_id: string;
  enabled: boolean;
  use_token: boolean;
}

interface AddProviderForm {
  name: string;
  base_url: string;
  auth_method: iframeApi.ProviderAuthMethod;
  secret: string;
  callback_url: string;
  sandbox: boolean;
}

const emptyOutbound: OutboundForm = {
  client_id: 'default',
  game_id: 'aviator',
  enabled: true,
  use_token: true,
};

const emptyProvider: AddProviderForm = {
  name: '',
  base_url: 'https://provider.example.com',
  auth_method: 'token',
  secret: '',
  callback_url: '',
  sandbox: true,
};

interface LegacyForm {
  name: string;
  slug: string;
  embed_url: string;
  category: string;
  width: string;
  height: string;
  allow: string;
  sandbox: string;
  allowed_origins: string;
  visibility: 'admin' | 'user' | 'public';
  is_active: boolean;
}

const emptyLegacy: LegacyForm = {
  name: '',
  slug: '',
  embed_url: '',
  category: '',
  width: '100%',
  height: '600px',
  allow: 'fullscreen payment',
  sandbox: 'allow-scripts allow-same-origin allow-forms',
  allowed_origins: '',
  visibility: 'admin',
  is_active: true,
};

export function IframeIntegration() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [mode, setMode] = useState<Mode>('outbound');

  /* ---- Outbound state ---------------------------------------------------- */
  const [outboundConfigs, setOutboundConfigs] = useState<iframeApi.OutboundConfig[]>([]);
  const [whitelist, setWhitelist] = useState<iframeApi.WhitelistedDomain[]>([]);
  const [internalGames, setInternalGames] = useState<rtpApi.InternalGameRtp[]>([]);
  const [outboundForm, setOutboundForm] = useState<OutboundForm>(emptyOutbound);
  const [newDomain, setNewDomain] = useState('');

  /* ---- Inbound state ----------------------------------------------------- */
  const [providers, setProviders] = useState<iframeApi.ExternalProvider[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [showAddProvider, setShowAddProvider] = useState(false);
  const [providerForm, setProviderForm] = useState<AddProviderForm>(emptyProvider);
  const [newAllowedGame, setNewAllowedGame] = useState('');

  /* ---- Legacy iframe entries (kept for backwards-compat panels) --------- */
  const [legacyEntries, setLegacyEntries] = useState<iframeApi.IframeConfig[]>([]);
  const [legacyForm, setLegacyForm] = useState<LegacyForm>(emptyLegacy);
  const [legacyEditingId, setLegacyEditingId] = useState<string | null>(null);
  const [legacyModal, setLegacyModal] = useState(false);

  /* ---- Shared state ----------------------------------------------------- */
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadOutbound = useCallback(async () => {
    setLoading(true);
    try {
      const [bundle, games] = await Promise.all([
        iframeApi.getOutboundConfig(),
        rtpApi.listInternalGamesRtp(),
      ]);
      setOutboundConfigs(bundle.configs);
      setWhitelist(bundle.whitelisted_domains);
      setInternalGames(games);
      if (bundle.configs.length > 0) {
        const first = bundle.configs[0]!;
        setOutboundForm({
          client_id: first.client_id,
          game_id: first.game_id ?? 'aviator',
          enabled: first.enabled,
          use_token: first.use_token,
        });
      }
    } catch (err) {
      toast(`Outbound load failed: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInbound = useCallback(async () => {
    setLoading(true);
    try {
      const list = await iframeApi.listExternalProviders();
      setProviders(list);
      if (list.length > 0 && !selectedProviderId) {
        setSelectedProviderId(list[0]!.id);
      }
    } catch (err) {
      toast(`Inbound load failed: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedProviderId]);

  const loadLegacy = useCallback(async () => {
    setLoading(true);
    try {
      const items = await iframeApi.listIframeConfigs();
      setLegacyEntries(items);
    } catch (err) {
      toast(`Iframe configs load failed: ${(err as Error).message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuth) return;
    if (mode === 'outbound') void loadOutbound();
    if (mode === 'inbound') void loadInbound();
    if (mode === 'legacy') void loadLegacy();
  }, [isAuth, mode, loadOutbound, loadInbound, loadLegacy]);

  /* ----------------- Outbound handlers ----------------------------------- */
  const saveOutboundConfig = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await iframeApi.upsertOutboundConfig(outboundForm);
      toast('Outbound config saved.');
      await loadOutbound();
    } catch (err) {
      toast(`Save failed: ${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const addDomain = async () => {
    const trimmed = newDomain.trim();
    if (!trimmed) return;
    try {
      await iframeApi.addWhitelistDomain(trimmed);
      setNewDomain('');
      await loadOutbound();
      toast(`Domain "${trimmed}" added to whitelist.`);
    } catch (err) {
      toast(`Add domain failed: ${(err as Error).message}`, 'error');
    }
  };

  const removeDomain = async (domain: string) => {
    try {
      await iframeApi.removeWhitelistDomain(domain);
      await loadOutbound();
      toast(`Domain "${domain}" removed.`);
    } catch (err) {
      toast(`Remove failed: ${(err as Error).message}`, 'error');
    }
  };

  /* ----------------- Inbound handlers ------------------------------------ */
  const selectedProvider = useMemo(
    () => providers.find((p) => p.id === selectedProviderId) ?? null,
    [providers, selectedProviderId]
  );

  const addProvider = async () => {
    if (!providerForm.name.trim() || !providerForm.base_url.trim()) return;
    try {
      const created = await iframeApi.createExternalProvider({
        name: providerForm.name.trim(),
        base_url: providerForm.base_url.trim(),
        auth_method: providerForm.auth_method,
        secret: providerForm.secret.trim() || undefined,
        callback_url: providerForm.callback_url.trim() || undefined,
        sandbox: providerForm.sandbox,
      });
      toast(`Provider "${created.name}" added.`);
      setShowAddProvider(false);
      setProviderForm(emptyProvider);
      const list = await iframeApi.listExternalProviders();
      setProviders(list);
      setSelectedProviderId(created.id);
    } catch (err) {
      toast(`Add failed: ${(err as Error).message}`, 'error');
    }
  };

  const toggleProvider = async (p: iframeApi.ExternalProvider) => {
    const next: iframeApi.ProviderStatus = p.status === 'Active' ? 'Paused' : 'Active';
    try {
      await iframeApi.setExternalProviderStatus(p.id, next);
      const list = await iframeApi.listExternalProviders();
      setProviders(list);
      toast(`${p.name} → ${next}.`);
    } catch (err) {
      toast(`Toggle failed: ${(err as Error).message}`, 'error');
    }
  };

  const removeProvider = async (p: iframeApi.ExternalProvider) => {
    if (!window.confirm(`Remove provider "${p.name}"?`)) return;
    try {
      await iframeApi.deleteExternalProvider(p.id);
      const list = await iframeApi.listExternalProviders();
      setProviders(list);
      setSelectedProviderId(list[0]?.id ?? null);
      toast(`Provider removed.`);
    } catch (err) {
      toast(`Remove failed: ${(err as Error).message}`, 'error');
    }
  };

  const addAllowedGame = async () => {
    if (!selectedProvider || !newAllowedGame.trim()) return;
    try {
      await iframeApi.addProviderGame(selectedProvider.id, {
        game_id: newAllowedGame.trim(),
      });
      setNewAllowedGame('');
      const list = await iframeApi.listExternalProviders();
      setProviders(list);
      toast('Game added.');
    } catch (err) {
      toast(`Add failed: ${(err as Error).message}`, 'error');
    }
  };

  const removeAllowedGame = async (gameId: string) => {
    if (!selectedProvider) return;
    try {
      await iframeApi.removeProviderGame(selectedProvider.id, gameId);
      const list = await iframeApi.listExternalProviders();
      setProviders(list);
      toast('Game removed.');
    } catch (err) {
      toast(`Remove failed: ${(err as Error).message}`, 'error');
    }
  };

  /* ----------------- Legacy iframe handlers ------------------------------ */
  const openLegacyCreate = () => {
    setLegacyEditingId(null);
    setLegacyForm(emptyLegacy);
    setLegacyModal(true);
  };

  const openLegacyEdit = (item: iframeApi.IframeConfig) => {
    const cfg = (item.config ?? {}) as Record<string, unknown>;
    setLegacyEditingId(item.id);
    setLegacyForm({
      name: item.name,
      slug: item.slug,
      embed_url: item.embed_url,
      category: typeof cfg.category === 'string' ? cfg.category : '',
      width: item.width,
      height: item.height,
      allow: typeof cfg.allow === 'string' ? cfg.allow : emptyLegacy.allow,
      sandbox: typeof cfg.sandbox === 'string' ? cfg.sandbox : emptyLegacy.sandbox,
      allowed_origins: (item.allowed_origins ?? []).join(', '),
      visibility: item.visibility,
      is_active: item.is_active,
    });
    setLegacyModal(true);
  };

  const saveLegacy = async () => {
    if (saving) return;
    if (!legacyForm.name.trim() || !legacyForm.slug.trim() || !legacyForm.embed_url.trim()) {
      toast('Name, slug, and URL are required.', 'error');
      return;
    }
    if (!/^https:\/\//i.test(legacyForm.embed_url.trim())) {
      toast('Embed URL must start with https://', 'error');
      return;
    }
    setSaving(true);
    try {
      const allowed_origins = legacyForm.allowed_origins
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const payload: iframeApi.CreateIframeInput = {
        name: legacyForm.name.trim(),
        slug: legacyForm.slug.trim(),
        embed_url: legacyForm.embed_url.trim(),
        category: legacyForm.category.trim() || undefined,
        width: legacyForm.width.trim(),
        height: legacyForm.height.trim(),
        allow: legacyForm.allow.trim() || undefined,
        sandbox: legacyForm.sandbox.trim() || undefined,
        allowed_origins,
        visibility: legacyForm.visibility,
        is_active: legacyForm.is_active,
      };
      if (legacyEditingId) {
        await iframeApi.updateIframeConfig(legacyEditingId, payload);
        toast('Iframe updated.');
      } else {
        await iframeApi.createIframeConfig(payload);
        toast('Iframe created.');
      }
      setLegacyModal(false);
      setLegacyEditingId(null);
      await loadLegacy();
    } catch (err) {
      toast(`Save failed: ${(err as Error).message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeLegacy = async (id: string) => {
    try {
      await iframeApi.deleteIframeConfig(id);
      await loadLegacy();
      toast('Iframe deleted.');
    } catch (err) {
      toast(`Delete failed: ${(err as Error).message}`, 'error');
    }
  };

  const toggleLegacy = async (id: string) => {
    try {
      await iframeApi.toggleIframeConfig(id);
      await loadLegacy();
    } catch (err) {
      toast(`Toggle failed: ${(err as Error).message}`, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center space-x-3">
          <Code2 className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Iframe Integration</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Outbound: serve YOUR games to white-label clients. Inbound: receive games from
              external providers.
            </p>
          </div>
        </div>
        <div className="inline-flex rounded-md shadow-sm" role="group">
          <button
            type="button"
            onClick={() => setMode('outbound')}
            className={`px-4 py-2 text-sm font-medium border ${
              mode === 'outbound'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            } rounded-l-lg`}
          >
            <Globe size={14} className="inline mr-1.5" />
            Outbound
          </button>
          <button
            type="button"
            onClick={() => setMode('inbound')}
            className={`px-4 py-2 text-sm font-medium border-t border-b ${
              mode === 'inbound'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            <ServerCog size={14} className="inline mr-1.5" />
            Inbound
          </button>
          <button
            type="button"
            onClick={() => setMode('legacy')}
            className={`px-4 py-2 text-sm font-medium border ${
              mode === 'legacy'
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            } rounded-r-lg`}
          >
            <ShieldCheck size={14} className="inline mr-1.5" />
            Generic Iframes
          </button>
        </div>
      </div>

      {/* ============================= OUTBOUND ============================= */}
      {mode === 'outbound' && (
        <div className="space-y-6">
          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 text-xs text-blue-900">
            White-label clients embed{' '}
            <code>https://games.&lt;your-domain&gt;/embed?client_id=…&amp;game=…&amp;token=…</code>.
            The backend validates the requesting domain against the whitelist below, checks
            (client_id, game_id) is enabled, then redirects to the game engine.
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Outbound Game Config</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Each (client_id, game_id) row controls one outbound channel. Toggle{' '}
                <code>use_token</code> if the white-label client passes a session token from their
                user system.
              </p>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Client ID</label>
                <input
                  value={outboundForm.client_id}
                  onChange={(e) =>
                    setOutboundForm((p) => ({ ...p, client_id: e.target.value }))
                  }
                  placeholder="playx"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Game</label>
                <select
                  value={outboundForm.game_id}
                  onChange={(e) =>
                    setOutboundForm((p) => ({ ...p, game_id: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  {internalGames.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name} ({g.id})
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={outboundForm.enabled}
                  onChange={(e) =>
                    setOutboundForm((p) => ({ ...p, enabled: e.target.checked }))
                  }
                />
                Enabled
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={outboundForm.use_token}
                  onChange={(e) =>
                    setOutboundForm((p) => ({ ...p, use_token: e.target.checked }))
                  }
                />
                Require session token
              </label>
              <div className="col-span-2">
                <button
                  type="button"
                  onClick={() => void saveOutboundConfig()}
                  disabled={saving}
                  className="px-4 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {saving ? 'Saving…' : 'Save config'}
                </button>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Active Outbound Channels</h2>
            </div>
            <div className="p-6 space-y-2">
              {outboundConfigs.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No outbound channels yet — fill the form above and save.
                </p>
              ) : (
                outboundConfigs.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between border border-gray-200 rounded p-3 text-sm"
                  >
                    <div>
                      <span className="font-semibold">{c.client_id}</span>
                      <span className="text-gray-400"> · </span>
                      <span>{c.game_id ?? '—'}</span>
                      <span className="text-gray-400"> · </span>
                      <span className={c.enabled ? 'text-green-700' : 'text-gray-500'}>
                        {c.enabled ? 'enabled' : 'disabled'}
                      </span>
                      <span className="text-gray-400"> · </span>
                      <span className="text-gray-500">
                        token: {c.use_token ? 'required' : 'optional'}
                      </span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-medium text-gray-900">Whitelisted Embed Domains</h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Only requests whose Origin header host matches a row below are allowed to load the
                <code className="ml-1">/embed</code> endpoint.
              </p>
            </div>
            <div className="p-6 space-y-3">
              <div className="flex gap-2">
                <input
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  placeholder="playx.et"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <button
                  type="button"
                  onClick={() => void addDomain()}
                  className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus size={14} className="mr-1.5" />
                  Add
                </button>
              </div>
              <div className="space-y-2">
                {whitelist.length === 0 ? (
                  <p className="text-sm text-gray-400">No domains whitelisted yet.</p>
                ) : (
                  whitelist.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between border border-gray-200 rounded p-3 text-sm"
                    >
                      <span className="font-mono">{d.domain}</span>
                      <button
                        type="button"
                        onClick={() => void removeDomain(d.domain)}
                        className="text-red-600 hover:text-red-800"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================= INBOUND ============================= */}
      {mode === 'inbound' && (
        <div className="space-y-6">
          <div className="bg-purple-50 border border-purple-100 rounded-lg px-4 py-2.5 text-xs text-purple-900">
            External providers (Pragmatic Play, Spribe, …) live here. Provider secrets are AES-256
            encrypted at rest — the frontend can SEND them, but they are never returned.
          </div>

          <div className="bg-white rounded-lg shadow">
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-lg font-medium text-gray-900">External Providers</h2>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void loadInbound()}
                  className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <RefreshCw size={14} className="mr-1.5" /> Refresh
                </button>
                <button
                  type="button"
                  onClick={() => setShowAddProvider(true)}
                  className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
                >
                  <Plus size={14} className="mr-1.5" /> Add Provider
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-6">
              <div className="md:col-span-1 space-y-2">
                {providers.length === 0 && !loading ? (
                  <p className="text-sm text-gray-500">No providers configured yet.</p>
                ) : (
                  providers.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedProviderId(p.id)}
                      className={`w-full text-left border rounded p-3 transition-colors ${
                        selectedProviderId === p.id
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <div className="font-semibold text-sm">{p.name}</div>
                      <div className="text-xs text-gray-500 truncate">{p.base_url}</div>
                      <div className="flex items-center gap-2 text-xs mt-1">
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            p.status === 'Active'
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {p.status}
                        </span>
                        {p.sandbox && (
                          <span className="px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700">
                            sandbox
                          </span>
                        )}
                        {p.has_secret ? (
                          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
                            secret set
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">
                            no secret
                          </span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>

              <div className="md:col-span-2">
                {selectedProvider ? (
                  <div className="space-y-4 border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-base font-semibold">{selectedProvider.name}</h3>
                        <p className="text-xs text-gray-500 truncate">
                          slug: <code>{selectedProvider.slug}</code> · auth:{' '}
                          {selectedProvider.auth_method}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => void toggleProvider(selectedProvider)}
                          className={`inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium ${
                            selectedProvider.status === 'Active'
                              ? 'bg-red-50 text-red-700 hover:bg-red-100'
                              : 'bg-green-50 text-green-700 hover:bg-green-100'
                          }`}
                        >
                          <Power size={12} className="mr-1" />
                          {selectedProvider.status === 'Active' ? 'Pause' : 'Activate'}
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeProvider(selectedProvider)}
                          className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200"
                        >
                          <Trash2 size={12} className="mr-1" /> Delete
                        </button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs text-gray-600">
                      <div>
                        <span className="font-medium">Base URL:</span>{' '}
                        <code className="break-all">{selectedProvider.base_url}</code>
                      </div>
                      <div>
                        <span className="font-medium">Callback URL:</span>{' '}
                        <code className="break-all">{selectedProvider.callback_url ?? '—'}</code>
                      </div>
                      <div>
                        <span className="font-medium">Sandbox:</span>{' '}
                        {selectedProvider.sandbox ? 'Yes' : 'No'}
                      </div>
                      <div>
                        <span className="font-medium">Last ping:</span>{' '}
                        {selectedProvider.last_ping ?? 'never'}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium mb-2">Allowed Games</h4>
                      <div className="flex gap-2 mb-2">
                        <input
                          value={newAllowedGame}
                          onChange={(e) => setNewAllowedGame(e.target.value)}
                          placeholder="provider_game_id"
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void addAllowedGame()}
                          className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
                        >
                          <Plus size={14} className="mr-1" /> Add
                        </button>
                      </div>
                      {selectedProvider.games.length === 0 ? (
                        <p className="text-xs text-gray-400">No games allowed yet.</p>
                      ) : (
                        <ul className="space-y-1">
                          {selectedProvider.games.map((g) => (
                            <li
                              key={g.game_id}
                              className="flex items-center justify-between border border-gray-200 rounded p-2 text-sm"
                            >
                              <span>
                                <code>{g.game_id}</code>
                                {!g.enabled && (
                                  <span className="ml-2 text-xs text-gray-400">(disabled)</span>
                                )}
                              </span>
                              <button
                                type="button"
                                onClick={() => void removeAllowedGame(g.game_id)}
                                className="text-red-600 hover:text-red-800"
                              >
                                <Trash2 size={12} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">Select a provider to manage allowed games.</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================= LEGACY iframe entries ================= */}
      {mode === 'legacy' && (
        <div className="space-y-6">
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => void loadLegacy()}
              className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <RefreshCw size={14} className="mr-1.5" /> Refresh
            </button>
            <button
              type="button"
              onClick={openLegacyCreate}
              className="inline-flex items-center px-3 py-2 rounded-md text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"
            >
              <Plus size={14} className="mr-1.5" /> Add Iframe
            </button>
          </div>

          <div className="bg-blue-50 border border-blue-100 rounded-lg px-4 py-2.5 text-xs text-blue-900">
            Generic iframe configurations stored in <code>iframe_integrations</code>. URLs are
            validated as HTTPS-only by the backend before saving.
          </div>

          <div className="bg-white rounded-lg shadow p-6 space-y-4">
            {legacyEntries.length === 0 && !loading && (
              <div className="text-sm text-gray-500">No iframe configs yet.</div>
            )}
            {legacyEntries.map((item) => {
              const cfg = (item.config ?? {}) as Record<string, unknown>;
              return (
                <div
                  key={item.id}
                  className="border border-gray-200 rounded-md p-4 flex items-start justify-between gap-4"
                >
                  <div className="space-y-1 min-w-0">
                    <p className="font-semibold text-gray-900">{item.name}</p>
                    <p className="text-xs text-gray-500">slug: {item.slug}</p>
                    <p className="text-xs text-gray-700 break-all">{item.embed_url}</p>
                    <p className="text-xs text-gray-500">
                      {item.width} × {item.height} · visibility: {item.visibility}
                      {typeof cfg.category === 'string' && cfg.category
                        ? ` · category: ${cfg.category}`
                        : ''}
                      {' · '}
                      {item.is_active ? 'active' : 'inactive'}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      onClick={() => openLegacyEdit(item)}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => void toggleLegacy(item.id)}
                      className="text-purple-600 hover:text-purple-800 text-sm"
                    >
                      Toggle
                    </button>
                    <button
                      onClick={() => void removeLegacy(item.id)}
                      className="text-red-600 hover:text-red-800"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add-provider modal (inbound) ---------------------------------- */}
      {showAddProvider && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Add External Provider</h3>
              <button
                onClick={() => setShowAddProvider(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  value={providerForm.name}
                  onChange={(e) => setProviderForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Pragmatic Play"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">Base URL (HTTPS)</label>
                <input
                  value={providerForm.base_url}
                  onChange={(e) =>
                    setProviderForm((p) => ({ ...p, base_url: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Auth Method</label>
                <select
                  value={providerForm.auth_method}
                  onChange={(e) =>
                    setProviderForm((p) => ({
                      ...p,
                      auth_method: e.target.value as iframeApi.ProviderAuthMethod,
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="token">Bearer Token</option>
                  <option value="apikey">X-API-Key</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Sandbox</label>
                <select
                  value={providerForm.sandbox ? 'yes' : 'no'}
                  onChange={(e) =>
                    setProviderForm((p) => ({ ...p, sandbox: e.target.value === 'yes' }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="yes">Yes (test mode)</option>
                  <option value="no">No (production)</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  API Secret (sealed AES-256 — never returned)
                </label>
                <input
                  type="password"
                  value={providerForm.secret}
                  onChange={(e) =>
                    setProviderForm((p) => ({ ...p, secret: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Webhook Callback URL (optional — defaults to <code>/hooks/&lt;slug&gt;</code>)
                </label>
                <input
                  value={providerForm.callback_url}
                  onChange={(e) =>
                    setProviderForm((p) => ({ ...p, callback_url: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setShowAddProvider(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void addProvider()}
                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                Save Provider
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Legacy iframe modal ------------------------------------------- */}
      {legacyModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">
                {legacyEditingId ? 'Edit Iframe' : 'Create Iframe'}
              </h3>
              <button
                onClick={() => setLegacyModal(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Name</label>
                <input
                  value={legacyForm.name}
                  onChange={(e) => setLegacyForm((p) => ({ ...p, name: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Slug</label>
                <input
                  value={legacyForm.slug}
                  onChange={(e) => setLegacyForm((p) => ({ ...p, slug: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Embed URL (HTTPS only)
                </label>
                <input
                  value={legacyForm.embed_url}
                  onChange={(e) =>
                    setLegacyForm((p) => ({ ...p, embed_url: e.target.value }))
                  }
                  placeholder="https://example.com/embed"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Visibility</label>
                <select
                  value={legacyForm.visibility}
                  onChange={(e) =>
                    setLegacyForm((p) => ({
                      ...p,
                      visibility: e.target.value as 'admin' | 'user' | 'public',
                    }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="admin">admin</option>
                  <option value="user">user</option>
                  <option value="public">public</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Width</label>
                <input
                  value={legacyForm.width}
                  onChange={(e) => setLegacyForm((p) => ({ ...p, width: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Height</label>
                <input
                  value={legacyForm.height}
                  onChange={(e) => setLegacyForm((p) => ({ ...p, height: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Allowed origins (comma-separated)
                </label>
                <input
                  value={legacyForm.allowed_origins}
                  onChange={(e) =>
                    setLegacyForm((p) => ({ ...p, allowed_origins: e.target.value }))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div className="col-span-2 flex items-end">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={legacyForm.is_active}
                    onChange={(e) =>
                      setLegacyForm((p) => ({ ...p, is_active: e.target.checked }))
                    }
                  />
                  Active
                </label>
              </div>
            </div>
            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                onClick={() => setLegacyModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void saveLegacy()}
                disabled={saving}
                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300"
              >
                {saving ? 'Saving…' : legacyEditingId ? 'Update Iframe' : 'Create Iframe'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
