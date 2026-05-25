import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowUpCircle, RefreshCw, Repeat, ShieldCheck, X, Clock } from 'lucide-react';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api/client';
import {
  approveWithdrawal,
  listWalletDevices,
  listWithdrawalQueue,
  rejectWithdrawal,
  setApprovalThreshold,
  switchWithdrawalWallet,
  type WithdrawalQueueRow,
} from '../../lib/api/p2p';

interface WithdrawalRow {
  id: string;
  user: string;
  amount: string;
  amountValue: number;
  wallet: string;
  status: 'Pending' | 'Processing' | 'Success' | 'Failed' | 'Awaiting Approval';
  requested: string;
}

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

function mapWithdrawalRow(row: WithdrawalQueueRow): WithdrawalRow {
  const raw = String(row.status ?? '');
  let status: WithdrawalRow['status'] = 'Pending';
  if (raw === 'pending' && row.is_awaiting_approval) status = 'Awaiting Approval';
  else if (raw === 'pending') status = 'Pending';
  else if (raw === 'processing') status = 'Processing';
  else if (raw === 'completed') status = 'Success';
  else if (['rejected', 'failed', 'cancelled'].includes(raw)) status = 'Failed';

  const amt = Number(row.amount);
  const cur = row.currency ? String(row.currency) : 'ETB';
  const amountValue = Number.isFinite(amt) ? amt : 0;
  const amount = `${cur} ${amountValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const user =
    String(row.user_email ?? row.user_phone ?? row.user_id ?? '—').trim() || '—';
  const wallet =
    String(row.telebirr_number ?? row.account_name ?? '—').trim() || '—';

  const ts = row.requested_at ?? row.created_at ?? '';
  const requested = ts ? new Date(ts).toLocaleString() : '—';

  return {
    id: String(row.id),
    user,
    amount,
    amountValue,
    wallet,
    status,
    requested,
  };
}

function StatusBadge({ status }: { status: WithdrawalRow['status'] }) {
  const colors: Record<WithdrawalRow['status'], string> = {
    Pending: 'bg-yellow-100 text-yellow-800',
    Processing: 'bg-blue-100 text-blue-800',
    Success: 'bg-green-100 text-green-800',
    Failed: 'bg-red-100 text-red-800',
    'Awaiting Approval': 'bg-orange-100 text-orange-800',
  };
  return (
    <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${colors[status]}`}>
      {status === 'Processing' && (
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 mr-1.5 mt-1 animate-pulse"></span>
      )}
      {status}
    </span>
  );
}

interface AgentOption {
  agent_id: string;
  label: string;
}

export function WithdrawalQueue() {
  const [rows, setRows] = useState<WithdrawalRow[]>([]);
  const [threshold, setThresholdState] = useState<number>(10000);
  const [loading, setLoading] = useState(true);
  const [showThresholdModal, setShowThresholdModal] = useState(false);
  const [thresholdDraft, setThresholdDraft] = useState(String(threshold));
  const [switchTarget, setSwitchTarget] = useState<WithdrawalRow | null>(null);
  const [switchAgentId, setSwitchAgentId] = useState('');
  const [agents, setAgents] = useState<AgentOption[]>([]);

  const loadAgents = useCallback(async () => {
    try {
      const res = await listWalletDevices({ page: 1, limit: 200 });
      const seen = new Set<string>();
      const opts: AgentOption[] = [];
      for (const w of res.items ?? []) {
        const id = String(w.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        const label =
          String(w.agent_name ?? '').trim() ||
          String(w.telebirr_number ?? '').trim() ||
          id.slice(0, 8);
        opts.push({ agent_id: id, label });
      }
      opts.sort((a, b) => a.label.localeCompare(b.label));
      setAgents(opts);
    } catch {
      setAgents([]);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listWithdrawalQueue({ page: 1, limit: 200 });
      setRows((res.items ?? []).map(mapWithdrawalRow));
      if (typeof res.manual_approval_threshold === 'number') {
        setThresholdState(res.manual_approval_threshold);
      }
    } catch (e) {
      toast(errMsg(e), 'error');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadAgents();
  }, [load, loadAgents]);

  const largeWithdrawals = useMemo(() => rows.filter((r) => r.status === 'Awaiting Approval'), [rows]);

  const counts = useMemo(() => {
    const tally = {
      Pending: 0,
      Processing: 0,
      'Awaiting Approval': 0,
      Success: 0,
      Failed: 0,
    };
    for (const r of rows) {
      tally[r.status]++;
    }
    return tally;
  }, [rows]);

  const saveThreshold = async () => {
    const n = Number(thresholdDraft);
    if (!Number.isFinite(n) || n < 0) {
      toast('Enter a valid threshold amount.', 'error');
      return;
    }
    try {
      await setApprovalThreshold({ manual_approval_threshold: n });
      setThresholdState(n);
      setShowThresholdModal(false);
      toast('Manual approval threshold saved.');
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const onApprove = async (row: WithdrawalRow) => {
    try {
      await approveWithdrawal(row.id, {});
      toast('Withdrawal approved.');
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const onReject = async (row: WithdrawalRow) => {
    const reason = window.prompt('Reject reason (required):');
    if (!reason?.trim()) {
      toast('Reject cancelled.', 'info');
      return;
    }
    try {
      await rejectWithdrawal(row.id, { reason: reason.trim() });
      toast('Withdrawal rejected.');
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  const submitSwitch = async () => {
    if (!switchTarget || !switchAgentId) return;
    try {
      await switchWithdrawalWallet(switchTarget.id, { agent_id: switchAgentId });
      toast('Withdrawal routing switched.');
      setSwitchTarget(null);
      setSwitchAgentId('');
      await load();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <ArrowUpCircle className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Withdrawal Queue</h1>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <p className="text-sm text-gray-500">Pending</p>
          <p className="text-2xl font-semibold text-yellow-600 mt-1">{loading ? '…' : counts.Pending}</p>
          <p className="text-xs text-gray-400 mt-1">Loaded batch</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <p className="text-sm text-gray-500">Processing</p>
          <p className="text-2xl font-semibold text-blue-600 mt-1">{loading ? '…' : counts.Processing}</p>
          <p className="text-xs text-gray-400 mt-1">Loaded batch</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <p className="text-sm text-gray-500">Awaiting Approval</p>
          <p className="text-2xl font-semibold text-orange-600 mt-1">{loading ? '…' : counts['Awaiting Approval']}</p>
          <p className="text-xs text-gray-400 mt-1">Loaded batch</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <p className="text-sm text-gray-500">Completed</p>
          <p className="text-2xl font-semibold text-green-600 mt-1">{loading ? '…' : counts.Success}</p>
          <p className="text-xs text-gray-400 mt-1">Loaded batch</p>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm">
          <p className="text-sm text-gray-500">Failed</p>
          <p className="text-2xl font-semibold text-red-600 mt-1">{loading ? '…' : counts.Failed}</p>
          <p className="text-xs text-gray-400 mt-1">Loaded batch</p>
        </div>
      </div>

      {largeWithdrawals.length > 0 && (
        <div className="bg-white rounded-lg shadow border-l-4 border-orange-500">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div className="flex items-center space-x-3">
              <ShieldCheck className="h-5 w-5 text-orange-600" />
              <div>
                <h2 className="text-lg font-medium text-gray-900">Manual Approval Required</h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  Withdrawals at or above{' '}
                  <span className="font-medium">ETB {threshold.toLocaleString()}</span> are held for admin approval before USSD dispatch.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setThresholdDraft(String(threshold));
                setShowThresholdModal(true);
              }}
              className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              Set Threshold
            </button>
          </div>
          <div className="divide-y divide-gray-100">
            {largeWithdrawals.map((row) => (
              <div key={row.id} className="px-6 py-4 flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="p-2 bg-orange-50 rounded-lg">
                    <Clock className="h-5 w-5 text-orange-600" />
                  </div>
                  <div>
                    <div className="flex items-center space-x-2">
                      <p className="text-sm font-medium text-gray-900 font-mono">{row.id.slice(0, 8)}…</p>
                      <StatusBadge status={row.status} />
                    </div>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {row.user} · {row.wallet} · {row.requested}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-4">
                  <span className="text-lg font-semibold text-gray-900">{row.amount}</span>
                  <button
                    type="button"
                    onClick={() => void onApprove(row)}
                    className="inline-flex items-center px-3 py-1.5 border border-transparent rounded-md text-xs font-medium text-white bg-green-600 hover:bg-green-700"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => void onReject(row)}
                    className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showThresholdModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="h-5 w-5 text-orange-600" />
                <h3 className="text-lg font-medium text-gray-900">Manual Approval Threshold</h3>
              </div>
              <button type="button" onClick={() => setShowThresholdModal(false)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600">
                Any withdrawal at or above this amount will require admin approval before being dispatched to a wallet device.
              </p>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Threshold (ETB)</label>
                <input
                  type="number"
                  value={thresholdDraft}
                  onChange={(e) => setThresholdDraft(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end space-x-3 px-6 py-4 border-t border-gray-200 bg-gray-50 rounded-b-lg">
              <button
                type="button"
                onClick={() => setShowThresholdModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void saveThreshold()}
                className="px-4 py-2 border border-transparent rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
              >
                Save Threshold
              </button>
            </div>
          </div>
        </div>
      )}

      {switchTarget && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-medium text-gray-900">Switch wallet device</h3>
              <button type="button" onClick={() => setSwitchTarget(null)} className="text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-600">
              Pick the Telebirr agent (wallet device) that should execute withdrawal{' '}
              <span className="font-mono">{switchTarget.id.slice(0, 8)}…</span>.
            </p>
            <select
              value={switchAgentId}
              onChange={(e) => setSwitchAgentId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
            >
              <option value="">Select agent…</option>
              {agents.map((a) => (
                <option key={a.agent_id} value={a.agent_id}>
                  {a.label} ({a.agent_id.slice(0, 8)}…)
                </option>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSwitchTarget(null)}
                className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!switchAgentId}
                onClick={() => void submitSwitch()}
                className="px-4 py-2 rounded-md text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300"
              >
                Switch
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-start gap-4">
          <div>
            <h2 className="text-lg font-medium text-gray-900">USSD Execution Queue</h2>
            <p className="text-sm text-gray-500 mt-1">
              Withdrawals are executed by dispatching USSD commands to Android wallet devices.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setThresholdDraft(String(threshold));
              setShowThresholdModal(true);
            }}
            className="inline-flex items-center px-3 py-1.5 border border-gray-300 rounded-md text-xs font-medium text-gray-700 bg-white hover:bg-gray-50 shrink-0"
          >
            Threshold: ETB {threshold.toLocaleString()}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">User</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Wallet</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Requested</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                    Loading withdrawals…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-sm text-gray-500">
                    No withdrawal rows returned from the API.
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((row) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm text-gray-500 font-mono">{row.id.slice(0, 8)}…</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{row.user}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{row.amount}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{row.wallet}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{row.requested}</td>
                    <td className="px-6 py-4 text-sm">
                      <StatusBadge status={row.status} />
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        {row.status === 'Awaiting Approval' && (
                          <>
                            <button
                              type="button"
                              onClick={() => void onApprove(row)}
                              className="inline-flex items-center px-2.5 py-1 border border-transparent rounded text-xs font-medium text-white bg-green-600 hover:bg-green-700"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() => void onReject(row)}
                              className="inline-flex items-center px-2.5 py-1 border border-gray-300 rounded text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
                            >
                              Reject
                            </button>
                          </>
                        )}
                        {row.status !== 'Success' && (
                          <button
                            type="button"
                            onClick={() => {
                              setSwitchTarget(row);
                              setSwitchAgentId('');
                            }}
                            className="inline-flex items-center px-2.5 py-1 border border-gray-300 rounded text-xs font-medium text-gray-700 bg-white hover:bg-gray-50"
                          >
                            <Repeat size={12} className="mr-1" /> Switch Wallet
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
