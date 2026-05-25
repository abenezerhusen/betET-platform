/**
 * /bets/bet-for-me — Section 4 page.
 *
 * Four tabs:
 *   1. Commissions   GET  /api/admin/bet-for-me/commissions   (PUT to edit)
 *   2. Bets          GET  /api/admin/bets?type=bet_for_me
 *   3. Transactions  GET  /api/admin/bet-for-me/transactions
 *   4. Top Up        GET  /api/admin/bet-for-me/topups
 */
import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { TabGroup } from '../../components/TabGroup';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import * as betsApi from '../../lib/api/bets';
import * as bfmApi from '../../lib/api/betForMe';
import { useAuthStore } from '../../store/auth';
import {
  DollarSign,
  Users,
  TrendingUp,
  Wallet,
  RefreshCw,
  FileDown,
  Save,
} from 'lucide-react';

const tabs = [
  { id: 'commissions', label: 'Commissions' },
  { id: 'bets', label: 'Bets' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'topup', label: 'Top Up' },
];

const num = (s: string | number | null | undefined): number =>
  typeof s === 'number' ? s : Number(s ?? 0);

const StatCard = ({
  icon: Icon,
  title,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
}) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between mb-4">
      <div className="p-2 bg-blue-50 rounded-lg">
        <Icon className="h-6 w-6 text-blue-600" />
      </div>
    </div>
    <h3 className="text-lg font-semibold text-gray-900">{value}</h3>
    <p className="text-sm text-gray-500 mt-1">{title}</p>
  </div>
);

export function BetForMe() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  const canView = role === 'admin' || role === 'superadmin';

  const [activeTab, setActiveTab] = useState<
    'commissions' | 'bets' | 'transactions' | 'topup'
  >('commissions');

  const [commissions, setCommissions] = useState<bfmApi.CommissionsResponse | null>(
    null
  );
  const [editingRates, setEditingRates] = useState<Record<string, number>>({});
  const [defaultRate, setDefaultRate] = useState<number>(5);

  const [bets, setBets] = useState<betsApi.AdminBet[]>([]);
  const [transactions, setTransactions] = useState<bfmApi.BetForMeTransaction[]>(
    []
  );
  const [topups, setTopups] = useState<bfmApi.BetForMeTransaction[]>([]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Load commissions whenever the page mounts (cheap document).
  useEffect(() => {
    if (!isAuth || !canView) return;
    bfmApi
      .listCommissions()
      .then((res) => {
        setCommissions(res);
        const initial: Record<string, number> = {};
        res.items.forEach((c) => {
          initial[c.bet_type] = c.rate;
        });
        setEditingRates(initial);
        setDefaultRate(res.default ?? 5);
      })
      .catch((err: Error) =>
        toast(`Failed to load commissions: ${err.message}`, 'error')
      );
  }, [isAuth, canView, reloadTick]);

  // Load tab-specific data on tab switch.
  useEffect(() => {
    if (!isAuth || !canView) return;
    if (activeTab === 'commissions') return;
    let cancelled = false;
    setLoading(true);
    const promise = (() => {
      if (activeTab === 'bets') {
        return betsApi.listBets({ type: 'bet_for_me', limit: 300 }).then((res) => {
          if (!cancelled) setBets(res.items ?? []);
        });
      }
      if (activeTab === 'transactions') {
        return bfmApi.listTransactions({ limit: 300 }).then((res) => {
          if (!cancelled) setTransactions(res.items ?? []);
        });
      }
      if (activeTab === 'topup') {
        return bfmApi.listTopups({ limit: 300 }).then((res) => {
          if (!cancelled) setTopups(res.items ?? []);
        });
      }
      return Promise.resolve();
    })();
    promise
      .catch((err: Error) =>
        toast(`Failed to load ${activeTab}: ${err.message}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, canView, activeTab, reloadTick]);

  const saveCommissions = async () => {
    setSaving(true);
    try {
      const rates = (Object.keys(editingRates) as Array<
        bfmApi.BetForMeCommission['bet_type']
      >).map((bet_type) => ({
        bet_type,
        rate: editingRates[bet_type],
      }));
      await bfmApi.updateCommissions({ default: defaultRate, rates });
      toast('Commission rates saved.');
      setReloadTick((t) => t + 1);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to save commissions';
      toast(msg, 'error');
    } finally {
      setSaving(false);
    }
  };

  const betRows = useMemo(
    () =>
      bets.map((b) => ({
        id: b.id,
        date: b.placed_at ? new Date(b.placed_at).toLocaleString() : '—',
        betId: b.id.slice(0, 8),
        agent: b.cashier_name ?? b.cashier_email ?? '—',
        user: b.user_name ?? b.bet_for_user_phone ?? '—',
        phone: b.bet_for_user_phone ?? b.user_phone ?? '—',
        stake: num(b.stake),
        payout: num(b.actual_payout),
        status: b.status,
        currency: b.currency,
      })),
    [bets]
  );

  const transactionRows = useMemo(
    () =>
      transactions.map((t) => ({
        id: t.id,
        date: t.created_at ? new Date(t.created_at).toLocaleString() : '—',
        user: t.user_name ?? t.user_email ?? '—',
        phone: t.user_phone ?? '—',
        agent: t.cashier_name ?? t.cashier_email ?? '—',
        type: String(t.metadata?.kind ?? t.type),
        amount: num(t.amount),
        currency: t.currency,
        status: t.status,
        reference: t.reference ?? '—',
      })),
    [transactions]
  );

  const topupRows = useMemo(
    () =>
      topups.map((t) => ({
        id: t.id,
        date: t.created_at ? new Date(t.created_at).toLocaleString() : '—',
        agent: t.cashier_name ?? t.cashier_email ?? t.user_name ?? '—',
        phone: t.user_phone ?? '—',
        amount: num(t.amount),
        currency: t.currency,
        status: t.status,
        reference: t.reference ?? '—',
      })),
    [topups]
  );

  const handleExport = () => {
    if (activeTab === 'bets' && betRows.length) {
      downloadCsv(
        [
          { header: 'Date', accessor: 'date' as const },
          { header: 'Bet ID', accessor: 'betId' as const },
          { header: 'Agent', accessor: 'agent' as const },
          { header: 'User', accessor: 'user' as const },
          { header: 'Phone', accessor: 'phone' as const },
          { header: 'Stake', accessor: 'stake' as const },
          { header: 'Payout', accessor: 'payout' as const },
          { header: 'Status', accessor: 'status' as const },
          { header: 'Currency', accessor: 'currency' as const },
        ],
        betRows,
        `betforme-bets-${todayStamp()}`
      );
      return;
    }
    if (activeTab === 'transactions' && transactionRows.length) {
      downloadCsv(
        [
          { header: 'Date', accessor: 'date' as const },
          { header: 'User', accessor: 'user' as const },
          { header: 'Phone', accessor: 'phone' as const },
          { header: 'Agent', accessor: 'agent' as const },
          { header: 'Type', accessor: 'type' as const },
          { header: 'Amount', accessor: 'amount' as const },
          { header: 'Currency', accessor: 'currency' as const },
          { header: 'Status', accessor: 'status' as const },
          { header: 'Reference', accessor: 'reference' as const },
        ],
        transactionRows,
        `betforme-transactions-${todayStamp()}`
      );
      return;
    }
    if (activeTab === 'topup' && topupRows.length) {
      downloadCsv(
        [
          { header: 'Date', accessor: 'date' as const },
          { header: 'Agent', accessor: 'agent' as const },
          { header: 'Phone', accessor: 'phone' as const },
          { header: 'Amount', accessor: 'amount' as const },
          { header: 'Currency', accessor: 'currency' as const },
          { header: 'Status', accessor: 'status' as const },
          { header: 'Reference', accessor: 'reference' as const },
        ],
        topupRows,
        `betforme-topups-${todayStamp()}`
      );
      return;
    }
    toast('Nothing to export.', 'error');
  };

  if (!canView) {
    return (
      <div className="bg-white p-8 rounded-lg shadow text-center text-gray-600">
        Restricted page — Admin / Super Admin only.
      </div>
    );
  }

  const totalCommission = transactionRows.reduce((a, r) => a + r.amount, 0);
  const totalStake = betRows.reduce((a, r) => a + r.stake, 0);
  const uniqueUsers = new Set(betRows.map((r) => r.user)).size;
  const totalTopup = topupRows.reduce((a, r) => a + r.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Bet For Me</h1>
        <div className="flex items-center space-x-2">
          <button
            onClick={() => setReloadTick((t) => t + 1)}
            className="inline-flex items-center px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-700 bg-white hover:bg-gray-50"
            title="Refresh"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          {activeTab !== 'commissions' && (
            <button
              onClick={handleExport}
              className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
            >
              <FileDown className="h-4 w-4 mr-2" />
              Export CSV
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          icon={DollarSign}
          title="Commission Collected"
          value={loading ? '—' : totalCommission.toFixed(2)}
        />
        <StatCard
          icon={TrendingUp}
          title="Total Stake (Bet For Me)"
          value={loading ? '—' : totalStake.toFixed(2)}
        />
        <StatCard
          icon={Users}
          title="Unique Users Helped"
          value={loading ? '—' : String(uniqueUsers)}
        />
        <StatCard
          icon={Wallet}
          title="Agent Top-ups"
          value={loading ? '—' : totalTopup.toFixed(2)}
        />
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(t) => setActiveTab(t as typeof activeTab)}
      />

      {activeTab === 'commissions' ? (
        <div className="bg-white p-6 rounded-lg shadow space-y-4">
          <p className="text-sm text-gray-500">
            Commission percentage charged on top of the stake when an agent
            places a bet on a user's behalf. The rate depends on the type of
            bet.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {commissions?.items.map((c) => (
              <div key={c.bet_type} className="border rounded-md p-4">
                <p className="text-sm text-gray-500 capitalize">
                  {c.bet_type} bet
                </p>
                <div className="flex items-center mt-2">
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={editingRates[c.bet_type] ?? c.rate}
                    onChange={(e) =>
                      setEditingRates((prev) => ({
                        ...prev,
                        [c.bet_type]: Number(e.target.value),
                      }))
                    }
                    className="block w-24 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                  <span className="ml-2 text-sm text-gray-600">%</span>
                </div>
              </div>
            ))}
            <div className="border rounded-md p-4 bg-gray-50">
              <p className="text-sm text-gray-500">Default rate</p>
              <div className="flex items-center mt-2">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={defaultRate}
                  onChange={(e) => setDefaultRate(Number(e.target.value))}
                  className="block w-24 rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
                <span className="ml-2 text-sm text-gray-600">%</span>
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={saveCommissions}
              disabled={saving}
              className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving…' : 'Save Rates'}
            </button>
          </div>
        </div>
      ) : activeTab === 'bets' ? (
        <div className="bg-white rounded-lg shadow">
          <DataTable
            columns={[
              { header: 'Date', accessor: 'date' as const },
              { header: 'Bet ID', accessor: 'betId' as const },
              { header: 'Agent', accessor: 'agent' as const },
              { header: 'User', accessor: 'user' as const },
              { header: 'Phone', accessor: 'phone' as const },
              {
                header: 'Stake',
                accessor: 'stake' as const,
                render: (v: number) => v.toFixed(2),
              },
              {
                header: 'Payout',
                accessor: 'payout' as const,
                render: (v: number) => v.toFixed(2),
              },
              { header: 'Status', accessor: 'status' as const },
              { header: 'Currency', accessor: 'currency' as const },
            ]}
            data={betRows}
          />
          {loading && (
            <div className="px-6 pb-6 text-sm text-gray-500">Loading…</div>
          )}
        </div>
      ) : activeTab === 'transactions' ? (
        <div className="bg-white rounded-lg shadow">
          <DataTable
            columns={[
              { header: 'Date', accessor: 'date' as const },
              { header: 'User', accessor: 'user' as const },
              { header: 'Phone', accessor: 'phone' as const },
              { header: 'Agent', accessor: 'agent' as const },
              { header: 'Type', accessor: 'type' as const },
              {
                header: 'Amount',
                accessor: 'amount' as const,
                render: (v: number) => v.toFixed(2),
              },
              { header: 'Currency', accessor: 'currency' as const },
              { header: 'Status', accessor: 'status' as const },
              { header: 'Reference', accessor: 'reference' as const },
            ]}
            data={transactionRows}
          />
          {loading && (
            <div className="px-6 pb-6 text-sm text-gray-500">Loading…</div>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow">
          <DataTable
            columns={[
              { header: 'Date', accessor: 'date' as const },
              { header: 'Agent', accessor: 'agent' as const },
              { header: 'Phone', accessor: 'phone' as const },
              {
                header: 'Amount',
                accessor: 'amount' as const,
                render: (v: number) => v.toFixed(2),
              },
              { header: 'Currency', accessor: 'currency' as const },
              { header: 'Status', accessor: 'status' as const },
              { header: 'Reference', accessor: 'reference' as const },
            ]}
            data={topupRows}
          />
          {loading && (
            <div className="px-6 pb-6 text-sm text-gray-500">Loading…</div>
          )}
        </div>
      )}
    </div>
  );
}
