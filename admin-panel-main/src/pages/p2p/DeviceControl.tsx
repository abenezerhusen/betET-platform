import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Smartphone, Power, RotateCw, Send, X, Terminal } from 'lucide-react';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api/client';
import {
  broadcastCommand,
  issueCommand,
  listWalletDevices,
  updateWalletDevice,
  type WalletAgentRow,
} from '../../lib/api/p2p';

interface DeviceVM {
  id: string;
  name: string;
  phone: string;
  status: 'Online' | 'Offline';
  lastSeen: string;
  enabled: boolean;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

function rowToVm(a: WalletAgentRow): DeviceVM {
  const online = a.status === 'online' || a.status === 'active';
  return {
    id: a.id,
    name: a.agent_name || a.device_name || a.device_id || a.id.slice(0, 8),
    phone: a.telebirr_number || '—',
    status: online ? 'Online' : 'Offline',
    lastSeen: a.last_seen_at ? new Date(a.last_seen_at).toLocaleString() : 'Never',
    // Enabled = active/online. Disabling sets status to `inactive`, which
    // blocks the agent from logging in and from deposit/withdrawal rotation.
    enabled: a.status === 'active' || a.status === 'online',
  };
}

export function DeviceControl() {
  const [devices, setDevices] = useState<DeviceVM[]>([]);
  const [loading, setLoading] = useState(true);
  const [cmdDevice, setCmdDevice] = useState<DeviceVM | null>(null);
  const [cmdType, setCmdType] = useState('check_balance');
  const [withdrawPhone, setWithdrawPhone] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [dispatching, setDispatching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listWalletDevices({ limit: 200, page: 1 });
      setDevices((res.items ?? []).map(rowToVm));
    } catch (e) {
      toast(errMsg(e), 'error');
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onlineDevices = useMemo(() => devices.filter((d) => d.status === 'Online'), [devices]);

  const restartAllOnline = async () => {
    if (onlineDevices.length === 0) {
      toast('No online agents to restart.', 'info');
      return;
    }
    setDispatching(true);
    try {
      await broadcastCommand({ kind: 'restart', payload: {} });
      toast(`Restart broadcast to ${onlineDevices.length} online agent(s).`);
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setDispatching(false);
    }
  };

  const sendHeartbeatBroadcast = async () => {
    setDispatching(true);
    try {
      await broadcastCommand({ kind: 'heartbeat', payload: {} });
      toast('Heartbeat broadcast queued.');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setDispatching(false);
    }
  };

  const disableAgent = async (d: DeviceVM) => {
    try {
      await updateWalletDevice(d.id, { enabled: false });
      toast(`${d.name} disabled.`);
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const enableAgent = async (d: DeviceVM) => {
    try {
      await updateWalletDevice(d.id, { enabled: true });
      toast(`${d.name} enabled.`);
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const restartOne = async (d: DeviceVM) => {
    try {
      await issueCommand({ agent_id: d.id, kind: 'restart', payload: {} });
      toast(`Restart queued for ${d.name}.`);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const dispatchCommand = async () => {
    if (!cmdDevice) return;
    setDispatching(true);
    try {
      const kind = cmdType;
      let payload: Record<string, unknown> = {};
      if (kind === 'withdraw') {
        const amt = Number(withdrawAmount);
        if (!withdrawPhone.trim() || !Number.isFinite(amt) || amt <= 0) {
          toast('Withdraw requires recipient phone and positive amount.', 'error');
          setDispatching(false);
          return;
        }
        payload = { phone: withdrawPhone.trim(), amount: amt };
      }
      await issueCommand({
        agent_id: cmdDevice.id,
        kind,
        payload,
      });
      toast(`Command “${kind}” queued for ${cmdDevice.name}.`);
      setCmdDevice(null);
      setWithdrawPhone('');
      setWithdrawAmount('');
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setDispatching(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Terminal className="h-8 w-8 text-blue-600" />
        <h1 className="text-2xl font-semibold text-gray-900">Device Control Panel</h1>
      </div>

      <div className="bg-white p-4 rounded-lg shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center space-x-6 text-sm">
          <span className="flex items-center">
            <span className="h-2 w-2 rounded-full bg-green-500 mr-2"></span>
            <span className="text-gray-700">{devices.filter((d) => d.status === 'Online').length} Online</span>
          </span>
          <span className="flex items-center">
            <span className="h-2 w-2 rounded-full bg-red-500 mr-2"></span>
            <span className="text-gray-700">{devices.filter((d) => d.status === 'Offline').length} Offline</span>
          </span>
          {loading && <span className="text-gray-400">Loading…</span>}
        </div>
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            disabled={dispatching || loading}
            onClick={() => void restartAllOnline()}
            className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            <RotateCw size={14} className="mr-2" /> Restart All Online
          </button>
          <button
            type="button"
            disabled={dispatching || loading}
            onClick={() => void sendHeartbeatBroadcast()}
            className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            <Send size={14} className="mr-2" /> Broadcast heartbeat
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {devices.map((device) => (
          <div key={device.id} className="bg-white rounded-lg shadow">
            <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`p-2 rounded-lg ${device.status === 'Online' ? 'bg-green-50' : 'bg-gray-100'}`}>
                  <Smartphone className={`h-5 w-5 ${device.status === 'Online' ? 'text-green-600' : 'text-gray-400'}`} />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">{device.name}</h3>
                  <p className="text-xs text-gray-500">{device.phone}</p>
                </div>
              </div>
              <span
                className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                  device.status === 'Online' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                }`}
              >
                {device.status}
              </span>
            </div>
            <div className="p-5 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Last seen</span>
                <span className="text-gray-900">{device.lastSeen}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Agent ID</span>
                <span className="text-gray-900 font-mono text-xs">{device.id.slice(0, 8)}…</span>
              </div>
            </div>
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-200 flex items-center space-x-2">
              <button
                type="button"
                onClick={() => setCmdDevice(device)}
                disabled={device.status !== 'Online'}
                className="flex-1 inline-flex items-center justify-center px-3 py-1.5 border border-transparent rounded text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send size={12} className="mr-1" /> Send
              </button>
              <button
                type="button"
                disabled={device.status !== 'Online' || dispatching}
                onClick={() => void restartOne(device)}
                className="inline-flex items-center justify-center px-3 py-1.5 border border-gray-300 rounded text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RotateCw size={12} className="mr-1" /> Restart
              </button>
              {device.enabled ? (
                <button
                  type="button"
                  onClick={() => void disableAgent(device)}
                  className="inline-flex items-center justify-center px-3 py-1.5 border border-gray-300 rounded text-xs font-medium text-red-600 bg-white hover:bg-red-50"
                >
                  <Power size={12} className="mr-1" /> Disable
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void enableAgent(device)}
                  className="inline-flex items-center justify-center px-3 py-1.5 border border-gray-300 rounded text-xs font-medium text-green-600 bg-white hover:bg-green-50"
                >
                  <Power size={12} className="mr-1" /> Enable
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {!loading && devices.length === 0 && (
        <p className="text-sm text-gray-500 text-center">No wallet agents returned — register devices first.</p>
      )}

      {cmdDevice && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center space-x-2">
                <Send className="h-5 w-5 text-blue-600" />
                <h3 className="text-lg font-medium text-gray-900">Send Command</h3>
              </div>
              <button type="button" onClick={() => setCmdDevice(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Target agent</label>
                <input
                  readOnly
                  value={`${cmdDevice.name} (${cmdDevice.phone})`}
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Command Type</label>
                <select
                  value={cmdType}
                  onChange={(e) => setCmdType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="check_balance">Check Balance</option>
                  <option value="withdraw">Withdraw</option>
                  <option value="restart">Restart Device</option>
                  <option value="heartbeat">Force Heartbeat</option>
                </select>
              </div>
              {cmdType === 'withdraw' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Recipient Phone</label>
                    <input
                      value={withdrawPhone}
                      onChange={(e) => setWithdrawPhone(e.target.value)}
                      placeholder="+2519XXXXXXXX"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Amount (ETB)</label>
                    <input
                      type="number"
                      value={withdrawAmount}
                      onChange={(e) => setWithdrawAmount(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                </>
              )}
            </div>
            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                type="button"
                onClick={() => setCmdDevice(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={dispatching}
                onClick={() => void dispatchCommand()}
                className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
              >
                <Send size={16} className="mr-2" />
                Dispatch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
