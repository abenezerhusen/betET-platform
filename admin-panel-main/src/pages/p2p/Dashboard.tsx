import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StatCard } from '../../components/StatCard';
import { DataTable } from '../../components/DataTable';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Smartphone,
  AlertTriangle,
  Activity,
  CheckCircle,
  XCircle,
  Clock,
  Send,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api/client';
import {
  getDashboard,
  type DashboardActivityRow,
  type DashboardCapacityRow,
  type DashboardWalletStatusRow,
  type P2pDashboard,
} from '../../lib/api/p2p';

function errMsg(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return 'Something went wrong';
}

function fmtEtb(amountStr: string | null | undefined): string {
  const n = Number(amountStr ?? 0);
  if (!Number.isFinite(n)) return `ETB ${amountStr ?? '0'}`;
  return `ETB ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function statusLabel(status: string): string {
  const s = status?.toLowerCase() ?? '';
  if (s === 'active' || s === 'online') return 'Online';
  if (s === 'inactive' || s === 'offline') return 'Offline';
  if (s === 'maintenance') return 'Maintenance';
  return status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Unknown';
}

interface WalletRow {
  wallet: string;
  status: string;
  balance: string;
  dailyLimit: string;
  used: string;
}

interface CapacityRow {
  wallet: string;
  preDeposit: string;
  commission: string;
  available: string;
}

const walletColumns = [
  { header: 'Wallet', accessor: 'wallet' as const },
  {
    header: 'Status',
    accessor: 'status' as const,
    render: (value: string) => (
      <span
        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
          value === 'Online'
            ? 'bg-green-100 text-green-800'
            : value === 'Offline'
              ? 'bg-red-100 text-red-800'
              : 'bg-yellow-100 text-yellow-800'
        }`}
      >
        {value}
      </span>
    ),
  },
  { header: 'Balance', accessor: 'balance' as const },
  { header: 'Daily Limit', accessor: 'dailyLimit' as const },
  { header: 'Used Today', accessor: 'used' as const },
];

const capacityColumns = [
  { header: 'Wallet', accessor: 'wallet' as const },
  { header: 'Pre-Deposit', accessor: 'preDeposit' as const },
  { header: 'Commission', accessor: 'commission' as const },
  { header: 'Available Capacity', accessor: 'available' as const },
];

function activityIcon(row: DashboardActivityRow) {
  if (row.level === 'error')
    return <XCircle className="h-4 w-4 text-red-500" />;
  if (row.level === 'warning')
    return <Clock className="h-4 w-4 text-yellow-500" />;
  if (row.kind === 'deposit')
    return <ArrowDownCircle className="h-4 w-4 text-green-500" />;
  if (row.kind === 'withdrawal')
    return <ArrowUpCircle className="h-4 w-4 text-blue-500" />;
  if (row.kind === 'command')
    return <Send className="h-4 w-4 text-indigo-500" />;
  return <CheckCircle className="h-4 w-4 text-green-500" />;
}

const REFRESH_INTERVAL_MS = 30_000;

export function P2PDashboard() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<P2pDashboard | null>(null);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const res = await getDashboard();
      setData(res);
    } catch (e) {
      toast(errMsg(e), 'error');
      if (showSpinner) setData(null);
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(true);
    const id = window.setInterval(() => {
      void load(false);
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const kpis = data?.kpis ?? null;
  const walletStatus: DashboardWalletStatusRow[] = useMemo(
    () => data?.wallet_status ?? [],
    [data]
  );
  const capacityData: DashboardCapacityRow[] = useMemo(
    () => data?.capacity ?? [],
    [data]
  );
  const activity: DashboardActivityRow[] = useMemo(
    () => data?.activity_feed ?? [],
    [data]
  );

  const walletRows: WalletRow[] = useMemo(
    () =>
      walletStatus.map((w) => ({
        wallet: w.agent_name || w.device_name || w.telebirr_number,
        status: statusLabel(w.status),
        balance: fmtEtb(w.balance),
        dailyLimit: fmtEtb(w.daily_limit),
        used: fmtEtb(w.used_today),
      })),
    [walletStatus]
  );

  const capacityRows: CapacityRow[] = useMemo(
    () =>
      capacityData.map((c) => ({
        wallet: c.agent_name,
        preDeposit: fmtEtb(c.pre_deposit),
        commission: `${Number(c.commission_rate).toFixed(2)}%`,
        available: fmtEtb(c.available_capacity),
      })),
    [capacityData]
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Activity className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">P2P Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load(true)}
            className="text-sm font-medium text-blue-600 hover:text-blue-800 disabled:opacity-50"
            disabled={loading}
          >
            Refresh
          </button>
          <div className="inline-flex items-center px-3 py-1.5 bg-green-50 border border-green-200 rounded-full">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse mr-2"></span>
            <span className="text-sm font-medium text-green-700">Live · 30s</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Deposits Today"
          value={kpis ? fmtEtb(kpis.total_deposits_today) : loading ? '…' : '—'}
          description="Matched / credited volume"
        />
        <StatCard
          title="Total Withdrawals Today"
          value={kpis ? fmtEtb(kpis.total_withdrawals_today) : loading ? '…' : '—'}
          description="Completed withdrawals"
        />
        <StatCard
          title="Active Wallets"
          value={
            kpis ? `${kpis.active_agents} / ${kpis.total_agents}` : loading ? '…' : '—'
          }
          description="Devices online · total"
        />
        <StatCard
          title="Failed Transactions"
          value={kpis ? `${kpis.failed_today}` : loading ? '…' : '—'}
          description="Failed deposits + withdrawals today"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-lg shadow">
          <div className="flex justify-between items-center px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">Wallet Status</h2>
            <div className="flex items-center space-x-4 text-sm text-gray-500">
              <span className="flex items-center">
                <Smartphone size={14} className="mr-1" /> {walletRows.length} wallets
              </span>
            </div>
          </div>
          {loading ? (
            <div className="p-8 text-center text-sm text-gray-500">Loading wallets…</div>
          ) : (
            <DataTable columns={walletColumns} data={walletRows} />
          )}
        </div>

        <div className="bg-white rounded-lg shadow">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-medium text-gray-900">Live Activity</h2>
            <p className="text-xs text-gray-500 mt-1">
              Latest 20 deposits, withdrawals, commands & events.
            </p>
          </div>
          <div className="divide-y divide-gray-100 max-h-[420px] overflow-y-auto">
            {loading && (
              <div className="px-6 py-6 text-sm text-gray-500 text-center">Loading…</div>
            )}
            {!loading && activity.length === 0 && (
              <div className="px-6 py-6 text-sm text-gray-500 text-center">No events yet.</div>
            )}
            {!loading &&
              activity.map((item) => {
                const t = new Date(item.created_at).toLocaleString();
                const amount = item.amount ? fmtEtb(item.amount) : null;
                return (
                  <div key={`${item.kind}:${item.id}`} className="px-6 py-3 flex items-start space-x-3">
                    <div className="flex-shrink-0 mt-0.5">{activityIcon(item)}</div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900 break-words">
                        {item.message}
                        {amount ? <span className="ml-2 font-medium">({amount})</span> : null}
                      </p>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {item.kind} · {item.status} · {t}
                      </p>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-medium text-gray-900">Capacity Overview</h2>
          <p className="text-xs text-gray-500 mt-1">
            Pre-deposit · commission · available capacity per device.
          </p>
        </div>
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading capacity…</div>
        ) : (
          <DataTable columns={capacityColumns} data={capacityRows} />
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white p-5 rounded-lg shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-green-50 rounded-lg">
            <ArrowDownCircle className="h-6 w-6 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Successful deposits (today)</p>
            <p className="text-xl font-semibold text-gray-900">
              {kpis?.successful_deposits_today ?? '—'}
            </p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-blue-50 rounded-lg">
            <ArrowUpCircle className="h-6 w-6 text-blue-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Successful withdrawals (today)</p>
            <p className="text-xl font-semibold text-gray-900">
              {kpis?.successful_withdrawals_today ?? '—'}
            </p>
          </div>
        </div>
        <div className="bg-white p-5 rounded-lg shadow-sm flex items-center space-x-4">
          <div className="p-3 bg-red-50 rounded-lg">
            <AlertTriangle className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <p className="text-sm text-gray-500">Manual review (deposit SMS queue)</p>
            <p className="text-xl font-semibold text-gray-900">{kpis?.manual_review_count ?? '—'}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
