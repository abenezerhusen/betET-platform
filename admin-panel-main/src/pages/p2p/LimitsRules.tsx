import React, { useCallback, useEffect, useState } from 'react';
import { Sliders, GripVertical, Save, ArrowUp, ArrowDown, AlertTriangle, Bell, Mail, MessageSquare, Wallet } from 'lucide-react';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api/client';
import {
  getP2pSettings,
  updateP2pSettings,
  getWalletPriority,
  setWalletPriority,
  listWalletDevices,
} from '../../lib/api/p2p';

interface WalletPriorityRow {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

export function LimitsRules() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [maxDaily, setMaxDaily] = useState('100000');
  const [maxPerTx, setMaxPerTx] = useState('20000');
  const [autoSwitch, setAutoSwitch] = useState(true);
  const [switchThreshold, setSwitchThreshold] = useState('90');

  const [exhaustionFailover, setExhaustionFailover] = useState(true);
  const [exhaustionThreshold, setExhaustionThreshold] = useState('5');
  const [blockWalletOnEmpty, setBlockWalletOnEmpty] = useState(true);
  const [notifyAdmin, setNotifyAdmin] = useState(true);
  const [notifyAgent, setNotifyAgent] = useState(true);
  const [notifyChannel, setNotifyChannel] = useState<'sms' | 'email' | 'both'>('both');

  const [wallets, setWallets] = useState<WalletPriorityRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settings, prioRes, agentsRes] = await Promise.all([
        getP2pSettings(),
        getWalletPriority(),
        listWalletDevices({ limit: 200, page: 1 }),
      ]);

      setMaxDaily(String(num(settings.max_daily_per_wallet, 100000)));
      setMaxPerTx(String(num(settings.max_per_transaction, 20000)));
      setAutoSwitch(Boolean(settings.auto_switch_enabled ?? true));
      setSwitchThreshold(String(num(settings.auto_switch_threshold_pct, 90)));
      setExhaustionFailover(Boolean(settings.exhaustion_failover_enabled ?? true));
      setExhaustionThreshold(String(num(settings.exhaustion_threshold_pct, 5)));
      setBlockWalletOnEmpty(Boolean(settings.block_wallet_on_empty ?? true));
      setNotifyAdmin(Boolean(settings.notify_admin ?? true));
      setNotifyAgent(Boolean(settings.notify_agent ?? true));
      const ch = settings.notify_channel;
      setNotifyChannel(ch === 'sms' || ch === 'email' || ch === 'both' ? ch : 'both');

      const agents = agentsRes.items ?? [];
      const agentNames = new Map(agents.map((a) => [a.id, a.agent_name]));

      const prioItems = [...(prioRes.items ?? [])].sort((a, b) => a.priority - b.priority);
      let rows: WalletPriorityRow[] = prioItems.map((p, idx) => ({
        id: p.agent_id,
        name: agentNames.get(p.agent_id) ?? p.agent_id.slice(0, 8),
        priority: idx + 1,
        enabled: p.enabled,
      }));

      if (!rows.length && agents.length) {
        rows = agents.map((a, i) => ({
          id: a.id,
          name: a.agent_name,
          priority: i + 1,
          enabled: a.status !== 'inactive' && a.status !== 'suspended',
        }));
      }

      setWallets(rows);
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const move = (idx: number, dir: -1 | 1) => {
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= wallets.length) return;
    const copy = [...wallets];
    [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
    setWallets(copy.map((w, i) => ({ ...w, priority: i + 1 })));
  };

  const saveSettingsPayload = () => ({
    max_daily_per_wallet: Number(maxDaily),
    max_per_transaction: Number(maxPerTx),
    auto_switch_enabled: autoSwitch,
    auto_switch_threshold_pct: Number(switchThreshold),
    exhaustion_failover_enabled: exhaustionFailover,
    exhaustion_threshold_pct: Number(exhaustionThreshold),
    block_wallet_on_empty: blockWalletOnEmpty,
    notify_admin: notifyAdmin,
    notify_agent: notifyAgent,
    notify_channel: notifyChannel,
  });

  const saveLimitsAndFailover = async () => {
    setSaving(true);
    try {
      await updateP2pSettings(saveSettingsPayload());
      toast('P2P limits & failover settings saved.');
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  const savePriorityOnly = async () => {
    if (!wallets.length) {
      toast('No wallets to prioritize.', 'error');
      return;
    }
    setSaving(true);
    try {
      await setWalletPriority({
        items: wallets.map((w, i) => ({
          agent_id: w.id,
          priority: i + 1,
          enabled: w.enabled,
        })),
      });
      toast('Wallet priority saved.');
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <Sliders className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Limits & Rules</h1>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading || saving}
          className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loading && <p className="text-sm text-gray-500">Loading tenant P2P settings…</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">Transaction Limits</h2>
          </div>
          <div className="p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max daily per wallet (ETB)</label>
              <input
                type="number"
                value={maxDaily}
                onChange={(e) => setMaxDaily(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Applies per wallet device.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max per transaction (ETB)</label>
              <input
                type="number"
                value={maxPerTx}
                onChange={(e) => setMaxPerTx(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
            <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
              <div>
                <p className="text-sm font-medium text-gray-900">Auto-switch wallets</p>
                <p className="text-xs text-gray-500">Rotate when threshold reached</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={autoSwitch}
                  onChange={(e) => setAutoSwitch(e.target.checked)}
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
              </label>
            </div>
            {autoSwitch && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Switch threshold ({switchThreshold}% of daily limit)
                </label>
                <input
                  type="range"
                  min="50"
                  max="100"
                  value={switchThreshold}
                  onChange={(e) => setSwitchThreshold(e.target.value)}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500">
                  <span>50%</span>
                  <span>75%</span>
                  <span>100%</span>
                </div>
              </div>
            )}
            <button
              type="button"
              disabled={saving || loading}
              onClick={() => void saveLimitsAndFailover()}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              <Save size={16} className="mr-2" /> Save limits &amp; notifications
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow lg:col-span-2 border-l-4 border-orange-500">
          <div className="px-6 py-4 border-b border-gray-200 flex items-start justify-between">
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-orange-50 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <h2 className="text-lg font-medium text-gray-900">Pre-Deposit Exhaustion Failover</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Configure exhaustion detection and who gets notified when capacity runs low.
                </p>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-5">
            <div className="flex items-center justify-between bg-orange-50 p-3 rounded-lg border border-orange-100">
              <div>
                <p className="text-sm font-medium text-gray-900">Enable auto-switch on exhaustion</p>
                <p className="text-xs text-gray-600 mt-0.5">
                  Route the next transaction to the next wallet in priority order.
                </p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer flex-shrink-0 ml-4">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={exhaustionFailover}
                  onChange={(e) => setExhaustionFailover(e.target.checked)}
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-orange-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600"></div>
              </label>
            </div>

            {exhaustionFailover && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Exhaustion threshold ({exhaustionThreshold}% of total capacity)
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="20"
                      step="1"
                      value={exhaustionThreshold}
                      onChange={(e) => setExhaustionThreshold(e.target.value)}
                      className="w-full accent-orange-600"
                    />
                    <div className="flex justify-between text-xs text-gray-500 mt-1">
                      <span>0%</span>
                      <span>10%</span>
                      <span>20%</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Block exhausted wallet</p>
                      <p className="text-xs text-gray-500">Stop routing until topped up</p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer flex-shrink-0 ml-4">
                      <input
                        type="checkbox"
                        className="sr-only peer"
                        checked={blockWalletOnEmpty}
                        onChange={(e) => setBlockWalletOnEmpty(e.target.checked)}
                      />
                      <div className="w-11 h-6 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                    </label>
                  </div>
                </div>

                <div className="border-t border-gray-200 pt-5">
                  <p className="text-sm font-medium text-gray-900 mb-3 flex items-center">
                    <Bell size={14} className="mr-2 text-blue-600" />
                    Notifications when wallet is exhausted
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <label className="flex items-center p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={notifyAdmin}
                        onChange={(e) => setNotifyAdmin(e.target.checked)}
                        className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">Notify Admin</p>
                        <p className="text-xs text-gray-500">Alert ops when capacity is exhausted</p>
                      </div>
                    </label>
                    <label className="flex items-center p-3 border border-gray-200 rounded-lg cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        checked={notifyAgent}
                        onChange={(e) => setNotifyAgent(e.target.checked)}
                        className="h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                      />
                      <div className="ml-3">
                        <p className="text-sm font-medium text-gray-900">Notify Agent</p>
                        <p className="text-xs text-gray-500">Ping the wallet agent / cashier device owner</p>
                      </div>
                    </label>
                  </div>

                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-700 mb-2">Delivery channel</label>
                    <div className="inline-flex rounded-md shadow-sm" role="group">
                      {(
                        [
                          { id: 'sms' as const, label: 'SMS', icon: MessageSquare },
                          { id: 'email' as const, label: 'Email', icon: Mail },
                          { id: 'both' as const, label: 'SMS + Email', icon: Bell },
                        ] as const
                      ).map((c, i, arr) => {
                        const Icon = c.icon;
                        const active = notifyChannel === c.id;
                        return (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => setNotifyChannel(c.id)}
                            className={`inline-flex items-center px-3 py-1.5 text-sm font-medium border ${
                              i === 0 ? 'rounded-l-md' : ''
                            } ${i === arr.length - 1 ? 'rounded-r-md' : ''} ${i > 0 ? '-ml-px' : ''} ${
                              active
                                ? 'bg-blue-600 text-white border-blue-600 z-10'
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <Icon size={14} className="mr-1.5" />
                            {c.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 flex items-start space-x-2">
                  <Wallet size={16} className="text-blue-600 mt-0.5 flex-shrink-0" />
                  <div className="text-xs text-blue-900">
                    <p className="font-medium">Top-up workflow:</p>
                    <p className="mt-0.5 text-blue-800">
                      Agents top up from <span className="font-medium">P2P → Wallet Devices</span> so capacity returns and the wallet can be re-enabled automatically.
                    </p>
                  </div>
                </div>
              </>
            )}

            <button
              type="button"
              disabled={saving || loading}
              onClick={() => void saveLimitsAndFailover()}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-orange-600 hover:bg-orange-700 disabled:opacity-50"
            >
              <Save size={16} className="mr-2" /> Save failover &amp; notifications
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center">
            <div>
              <h2 className="text-lg font-medium text-gray-900">Wallet Priority Order</h2>
              <p className="text-sm text-gray-500 mt-1">Drag order via arrows; first wins when auto-switch runs.</p>
            </div>
            <button
              type="button"
              disabled={saving || loading || wallets.length === 0}
              onClick={() => void savePriorityOnly()}
              className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              <Save size={14} className="mr-1" /> Save priority
            </button>
          </div>
          <div className="p-4 space-y-2">
            {wallets.length === 0 && !loading && (
              <p className="text-sm text-gray-500 px-2">No agents yet — register wallet devices first.</p>
            )}
            {wallets.map((w, idx) => (
              <div
                key={w.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  w.enabled ? 'bg-white border-gray-200' : 'bg-gray-50 border-gray-200 opacity-60'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <GripVertical className="h-4 w-4 text-gray-400" />
                  <div className="h-7 w-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-semibold">
                    {idx + 1}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900">{w.name}</p>
                    <p className="text-xs text-gray-500 font-mono">{w.id.slice(0, 8)}…</p>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <label className="text-xs text-gray-600 mr-1">Active</label>
                  <input
                    type="checkbox"
                    checked={w.enabled}
                    onChange={() =>
                      setWallets((prev) =>
                        prev.map((x) => (x.id === w.id ? { ...x, enabled: !x.enabled } : x))
                      )
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => move(idx, -1)}
                    disabled={idx === 0}
                    className="p-1 hover:bg-gray-100 rounded disabled:opacity-30"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(idx, 1)}
                    disabled={idx === wallets.length - 1}
                    className="p-1 hover:bg-gray-100 rounded disabled:opacity-30"
                  >
                    <ArrowDown size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
