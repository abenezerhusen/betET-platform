import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Gamepad2, Edit2, X, Save, Search, Power, RotateCcw } from 'lucide-react';
import { z } from 'zod';
import * as rtpApi from '../../lib/api/rtp';
import * as packagesApi from '../../lib/api/packages';
import { toast } from '../../lib/toast';
import { useAuthStore } from '../../store/auth';

const rtpSchema = z.object({
  rtp: z.number().min(50).max(99),
});

export function RtpManagement() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [games, setGames] = useState<rtpApi.InternalGameRtp[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<rtpApi.InternalGameRtp | null>(null);
  const [rtpValue, setRtpValue] = useState(96);
  const [applyGlobal, setApplyGlobal] = useState(true);
  const [selectedClient, setSelectedClient] = useState<string>('');
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!isAuth) return;
    setLoading(true);
    rtpApi
      .listInternalGamesRtp()
      .then(setGames)
      .catch((err: Error) => toast(`Failed to load RTP: ${err.message}`, 'error'))
      .finally(() => setLoading(false));
  }, [isAuth]);

  const loadClients = useCallback(() => {
    if (!isAuth) return;
    // Spec: "client dropdown must load from real packages/clients".
    // listPackageClients returns the white-label tenants — their slug is
    // the canonical client_id used by game_rtp_overrides.
    void packagesApi
      .listPackageClients()
      .then((items) => {
        const slugs = items.map((c) => c.slug).filter(Boolean);
        setClients(slugs.length > 0 ? slugs : ['default']);
      })
      .catch(() => setClients(['default']));
  }, [isAuth]);

  useEffect(() => {
    load();
    loadClients();
  }, [load, loadClients]);

  useEffect(() => {
    if (clients.length > 0 && !selectedClient) {
      setSelectedClient(clients[0]!);
    }
  }, [clients, selectedClient]);

  const openEdit = (g: rtpApi.InternalGameRtp) => {
    setEditing(g);
    setRtpValue(Math.min(g.maxRtp, Math.max(g.minRtp, g.defaultRtp)));
    setApplyGlobal(true);
  };

  const save = async () => {
    if (!editing || saving) return;
    const parsed = rtpSchema.safeParse({ rtp: rtpValue });
    if (!parsed.success) {
      toast(parsed.error.issues[0]?.message ?? 'Invalid RTP value', 'error');
      return;
    }
    if (rtpValue < editing.minRtp || rtpValue > editing.maxRtp) {
      toast(`RTP must be between ${editing.minRtp}% and ${editing.maxRtp}%`, 'error');
      return;
    }
    setSaving(true);
    try {
      await rtpApi.updateGameRtp(editing.id, {
        rtp: rtpValue,
        apply_global: applyGlobal,
        client_id: applyGlobal ? null : selectedClient,
      });
      toast(
        applyGlobal
          ? `Updated default RTP for ${editing.name} to ${rtpValue.toFixed(2)}%.`
          : `Override for ${selectedClient}: ${editing.name} → ${rtpValue.toFixed(2)}%.`
      );
      const updated = await rtpApi.listInternalGamesRtp();
      setGames(updated);
      setEditing(null);
    } catch (err) {
      toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (g: rtpApi.InternalGameRtp) => {
    if (statusUpdating) return;
    const next: rtpApi.GameStatus = g.status === 'Active' ? 'Disabled' : 'Active';
    setStatusUpdating(g.id);
    try {
      await rtpApi.updateGameStatus(g.id, next);
      toast(`${g.name} ${next === 'Active' ? 'enabled' : 'disabled'}.`);
      const updated = await rtpApi.listInternalGamesRtp();
      setGames(updated);
    } catch (err) {
      toast(`Status change failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setStatusUpdating(null);
    }
  };

  const removeOverride = async (g: rtpApi.InternalGameRtp, clientId: string) => {
    if (saving) return;
    setSaving(true);
    try {
      // Replace override with default to "undo" — we don't have a DELETE
      // route for overrides yet; setting the override equal to the default
      // RTP is the simplest way to effectively clear it.
      await rtpApi.updateGameRtp(g.id, {
        rtp: g.defaultRtp,
        apply_global: false,
        client_id: clientId,
      });
      toast(`Override for ${clientId} reset to default ${g.defaultRtp.toFixed(2)}%.`);
      const updated = await rtpApi.listInternalGamesRtp();
      setGames(updated);
    } catch (err) {
      toast(`Reset failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(
    () =>
      games.filter(
        (g) =>
          g.name.toLowerCase().includes(search.toLowerCase()) ||
          g.provider.toLowerCase().includes(search.toLowerCase())
      ),
    [games, search]
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Gamepad2 className="h-8 w-8 text-blue-600" />
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">RTP Management</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Only the 4 internal-engine games appear here. External provider RTP (Pragmatic Play,
              Spribe, …) is controlled in the provider dashboard.
            </p>
          </div>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search games..."
            className="pl-9 pr-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">
            Internal Games ({loading ? 'loading…' : `${games.length} games`})
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Values come from <code className="text-xs">internal_games.default_rtp</code> (game-engine
            workers read this on every round). Each game has its own min/max RTP envelope; per-client
            overrides live in <code className="text-xs">game_rtp_overrides</code>.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Game</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Default RTP</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client Overrides</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && games.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                    Loading internal games…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-8 text-center text-sm text-gray-500">
                    No internal games matched your search.
                  </td>
                </tr>
              ) : (
                filtered.map((g) => (
                  <tr key={g.id} className="hover:bg-gray-50 align-top">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900 whitespace-nowrap">
                      {g.name}
                      <div className="text-xs text-gray-400 mt-0.5">{g.provider}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 whitespace-nowrap">
                      {g.gameType ?? '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900 whitespace-nowrap">
                      <span className="font-semibold">{g.defaultRtp.toFixed(2)}%</span>
                      <div className="text-xs text-gray-400 mt-0.5">
                        range {g.minRtp.toFixed(0)}–{g.maxRtp.toFixed(0)}%
                      </div>
                    </td>
                    <td className="px-6 py-4 text-xs text-gray-600">
                      {g.clientOverrides.length === 0 ? (
                        <span className="text-gray-400">No client overrides</span>
                      ) : (
                        <ul className="space-y-1">
                          {g.clientOverrides.map((o) => (
                            <li key={o.clientId} className="flex items-center gap-2">
                              <span className="font-medium">{o.clientId}</span>
                              <span className="text-blue-700">{o.rtp.toFixed(2)}%</span>
                              <button
                                type="button"
                                onClick={() => void removeOverride(g, o.clientId)}
                                className="text-red-600 hover:text-red-800 inline-flex items-center"
                                title="Reset to default"
                              >
                                <RotateCcw size={12} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm whitespace-nowrap">
                      <span
                        className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          g.status === 'Active'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {g.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm whitespace-nowrap space-x-3">
                      <button
                        type="button"
                        onClick={() => openEdit(g)}
                        className="inline-flex items-center text-blue-600 hover:text-blue-800 text-sm font-medium"
                      >
                        <Edit2 size={14} className="mr-1" /> Edit RTP
                      </button>
                      <button
                        type="button"
                        disabled={statusUpdating === g.id}
                        onClick={() => void toggleStatus(g)}
                        className={`inline-flex items-center text-sm font-medium ${
                          g.status === 'Active'
                            ? 'text-red-600 hover:text-red-800'
                            : 'text-green-600 hover:text-green-800'
                        } disabled:opacity-50`}
                      >
                        <Power size={14} className="mr-1" />
                        {g.status === 'Active' ? 'Disable' : 'Enable'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">Edit RTP — {editing.name}</h3>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  RTP Value:{' '}
                  <span className="font-semibold text-blue-600">{rtpValue.toFixed(2)}%</span>
                </label>
                <input
                  type="range"
                  min={editing.minRtp}
                  max={editing.maxRtp}
                  step={0.1}
                  value={rtpValue}
                  onChange={(e) => setRtpValue(parseFloat(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>{editing.minRtp.toFixed(0)}%</span>
                  <span>{((editing.minRtp + editing.maxRtp) / 2).toFixed(0)}%</span>
                  <span>{editing.maxRtp.toFixed(0)}%</span>
                </div>
              </div>
              <div className="bg-gray-50 p-4 rounded-lg space-y-3">
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    checked={applyGlobal}
                    onChange={() => setApplyGlobal(true)}
                    className="text-blue-600"
                    id="rtp-global"
                  />
                  <label htmlFor="rtp-global" className="text-sm">
                    Apply globally (every white-label client)
                  </label>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="radio"
                    checked={!applyGlobal}
                    onChange={() => setApplyGlobal(false)}
                    className="text-blue-600"
                    id="rtp-client"
                  />
                  <label htmlFor="rtp-client" className="text-sm">
                    Apply only to selected client
                  </label>
                </div>
                {!applyGlobal && (
                  <select
                    value={selectedClient}
                    onChange={(e) => setSelectedClient(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    {clients.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <p className="text-xs text-gray-500">
                Takes effect on the next round started by the game engine; the round currently in
                progress is not affected.
              </p>
            </div>
            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save()}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60"
              >
                <Save size={16} className="mr-2" /> {saving ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
