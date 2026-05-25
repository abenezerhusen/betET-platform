import React, { useCallback, useEffect, useState } from 'react';
import { Percent, Save, Plus, Trash2, Smartphone, TrendingUp } from 'lucide-react';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api/client';
import {
  deleteClientCommission,
  listCommissions,
  listWalletDevices,
  updateP2pSettings,
  upsertClientCommission,
  upsertWalletCommission,
} from '../../lib/api/p2p';

interface ClientOverrideRow {
  user_id: string;
  depositPct: string;
  withdrawPct: string;
}

interface WalletCommissionRow {
  agent_id: string;
  name: string;
  depositPct: string;
  withdrawPct: string;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

function num(v: string, fallback: number): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

export function Commissions() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [defaultDeposit, setDefaultDeposit] = useState('1.5');
  const [defaultWithdraw, setDefaultWithdraw] = useState('2.0');
  const [overrides, setOverrides] = useState<ClientOverrideRow[]>([]);
  const [walletRows, setWalletRows] = useState<WalletCommissionRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [comm, agentsRes] = await Promise.all([
        listCommissions(),
        listWalletDevices({ limit: 200, page: 1 }),
      ]);

      const defs = comm.defaults as { deposit_pct?: string; withdrawal_pct?: string } | null;
      const depFallback = defs ? String(defs.deposit_pct ?? '1.5') : '1.5';
      const wdFallback = defs ? String(defs.withdrawal_pct ?? '2.0') : '2.0';
      if (defs) {
        setDefaultDeposit(depFallback);
        setDefaultWithdraw(wdFallback);
      }

      const agentNames = new Map((agentsRes.items ?? []).map((a) => [a.id, a.agent_name]));

      const wc = (comm.wallets as Array<{ agent_id: string; deposit_pct: string; withdrawal_pct: string }>) ?? [];
      const baseRows = wc.map((w) => ({
        agent_id: w.agent_id,
        name: agentNames.get(w.agent_id) ?? w.agent_id.slice(0, 8),
        depositPct: String(w.deposit_pct),
        withdrawPct: String(w.withdrawal_pct),
      }));

      const orphanAgents = (agentsRes.items ?? []).filter((a) => !wc.some((x) => x.agent_id === a.id));
      const orphanRows: WalletCommissionRow[] = orphanAgents.map((a) => ({
        agent_id: a.id,
        name: a.agent_name,
        depositPct: depFallback,
        withdrawPct: wdFallback,
      }));

      setWalletRows([...baseRows, ...orphanRows]);

      const clients =
        (comm.clients as Array<{ user_id: string; deposit_pct: string; withdrawal_pct: string }>) ?? [];
      setOverrides(
        clients.map((c) => ({
          user_id: c.user_id,
          depositPct: String(c.deposit_pct),
          withdrawPct: String(c.withdrawal_pct),
        }))
      );
    } catch (e) {
      toast(errMsg(e), 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const totalProcessedPlaceholder = 0;
  const totalEarningsPlaceholder = 0;

  const updateWalletDeposit = (agent_id: string, v: string) => {
    setWalletRows((prev) => prev.map((w) => (w.agent_id === agent_id ? { ...w, depositPct: v } : w)));
  };

  const updateWalletWithdraw = (agent_id: string, v: string) => {
    setWalletRows((prev) => prev.map((w) => (w.agent_id === agent_id ? { ...w, withdrawPct: v } : w)));
  };

  const addOverride = () => {
    setOverrides((prev) => [...prev, { user_id: '', depositPct: '1.5', withdrawPct: '2.0' }]);
  };

  const removeOverrideAt = async (idx: number) => {
    const row = overrides[idx];
    if (!row) return;
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (row.user_id && uuidRe.test(row.user_id.trim())) {
      try {
        await deleteClientCommission(row.user_id.trim());
        toast('Override removed.');
      } catch (e) {
        toast(errMsg(e), 'error');
        return;
      }
    }
    setOverrides((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateOverride = (idx: number, field: keyof ClientOverrideRow, value: string) => {
    setOverrides((prev) => prev.map((o, i) => (i === idx ? { ...o, [field]: value } : o)));
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      await updateP2pSettings({
        default_deposit_commission_pct: num(defaultDeposit, 1.5),
        default_withdrawal_commission_pct: num(defaultWithdraw, 2),
      });

      for (const w of walletRows) {
        await upsertWalletCommission({
          agent_id: w.agent_id,
          deposit_pct: num(w.depositPct, 0),
          withdrawal_pct: num(w.withdrawPct, 0),
        });
      }

      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      for (const o of overrides) {
        const uid = o.user_id.trim();
        if (!uid || !uuidRe.test(uid)) continue;
        await upsertClientCommission({
          user_id: uid,
          deposit_pct: num(o.depositPct, 0),
          withdrawal_pct: num(o.withdrawPct, 0),
        });
      }

      toast('Commissions saved.');
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
          <Percent className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Commission System</h1>
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

      {loading && <p className="text-sm text-gray-500">Loading commission configuration…</p>}

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Default Commission Rates</h2>
          <p className="text-sm text-gray-500 mt-1">Stored on tenant P2P settings; applied unless overridden per wallet / client.</p>
        </div>
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Deposit Commission (%)</label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                value={defaultDeposit}
                onChange={(e) => setDefaultDeposit(e.target.value)}
                className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
              />
              <span className="absolute right-3 top-2 text-sm text-gray-500">%</span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Withdrawal Commission (%)</label>
            <div className="relative">
              <input
                type="number"
                step="0.01"
                value={defaultWithdraw}
                onChange={(e) => setDefaultWithdraw(e.target.value)}
                className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
              />
              <span className="absolute right-3 top-2 text-sm text-gray-500">%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-lg shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-blue-50 rounded-lg">
            <Smartphone className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Wallets configured</p>
            <p className="text-xl font-semibold text-gray-900">{walletRows.length}</p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-green-50 rounded-lg">
            <TrendingUp className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Processed today (UI)</p>
            <p className="text-xl font-semibold text-gray-900">
              ETB {totalProcessedPlaceholder.toLocaleString()} <span className="text-xs text-gray-400">n/a</span>
            </p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-purple-50 rounded-lg">
            <Percent className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Earnings today (UI)</p>
            <p className="text-xl font-semibold text-gray-900">
              ETB {totalEarningsPlaceholder.toLocaleString()} <span className="text-xs text-gray-400">n/a</span>
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Per-Wallet Commission</h2>
          <p className="text-sm text-gray-500 mt-1">
            Calls `PUT /api/admin/p2p/commissions/wallet` per agent below.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Wallet</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Deposit %</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Withdraw %</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {walletRows.map((w) => (
                <tr key={w.agent_id} className="hover:bg-gray-50">
                  <td className="px-6 py-3 text-sm font-medium text-gray-900">{w.name}</td>
                  <td className="px-6 py-3">
                    <input
                      type="number"
                      step="0.01"
                      value={w.depositPct}
                      onChange={(e) => updateWalletDeposit(w.agent_id, e.target.value)}
                      className="w-28 px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </td>
                  <td className="px-6 py-3">
                    <input
                      type="number"
                      step="0.01"
                      value={w.withdrawPct}
                      onChange={(e) => updateWalletWithdraw(w.agent_id, e.target.value)}
                      className="w-28 px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </td>
                </tr>
              ))}
              {!loading && walletRows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-8 text-center text-sm text-gray-500">
                    No wallet commissions — register agents first.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-medium text-gray-900">Per-Client Overrides</h2>
            <p className="text-sm text-gray-500 mt-1">
              Enter a user UUID; saves via `PUT /api/admin/p2p/commissions/client`.
            </p>
          </div>
          <button
            type="button"
            onClick={addOverride}
            className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <Plus size={14} className="mr-1" /> Add Override
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  User ID (UUID)
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Deposit %</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Withdraw %</th>
                <th className="px-6 py-3"></th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {overrides.map((o, idx) => (
                <tr key={`${idx}-${o.user_id}`}>
                  <td className="px-6 py-3">
                    <input
                      value={o.user_id}
                      onChange={(e) => updateOverride(idx, 'user_id', e.target.value)}
                      placeholder="User UUID"
                      className="w-full px-2 py-1 border border-gray-300 rounded text-sm font-mono text-xs"
                    />
                  </td>
                  <td className="px-6 py-3">
                    <input
                      type="number"
                      step="0.01"
                      value={o.depositPct}
                      onChange={(e) => updateOverride(idx, 'depositPct', e.target.value)}
                      className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </td>
                  <td className="px-6 py-3">
                    <input
                      type="number"
                      step="0.01"
                      value={o.withdrawPct}
                      onChange={(e) => updateOverride(idx, 'withdrawPct', e.target.value)}
                      className="w-24 px-2 py-1 border border-gray-300 rounded text-sm"
                    />
                  </td>
                  <td className="px-6 py-3 text-right">
                    <button type="button" onClick={() => void removeOverrideAt(idx)} className="text-red-600 hover:text-red-800">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {overrides.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm text-gray-500">
                    No overrides configured.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void saveAll()}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        >
          <Save size={16} className="mr-2" /> Save Commissions
        </button>
      </div>
    </div>
  );
}
