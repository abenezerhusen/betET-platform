import { useEffect, useMemo, useState } from 'react';
import { DateRangePicker } from '../components/DateRangePicker';
import { TabGroup } from '../components/TabGroup';
import { StatCard } from '../components/StatCard';
import { DataTable } from '../components/DataTable';
import {
  DollarSign,
  Ticket,
  ArrowUpDown,
  Users,
  Gift,
  TrendingUp,
  Wallet,
  Building,
} from 'lucide-react';
import { downloadCsv, todayStamp } from '../lib/csv';
import { toast } from '../lib/toast';
import * as dashboardApi from '../lib/api/dashboard';
import * as betsApi from '../lib/api/bets';
import { useAuthStore } from '../store/auth';
import { formatCurrency, formatInteger, toIso } from '../lib/format';

const tabs = [
  { id: 'summary', label: 'Summary Report' },
  { id: 'offline', label: 'Offline Report' },
  { id: 'online', label: 'Online Report' },
  { id: 'detailed', label: 'Detailed Report' },
];

type Tab = dashboardApi.DashboardTab;

interface DashboardState {
  loading: boolean;
  error: string | null;
  data: dashboardApi.DashboardResponse | null;
}

const EMPTY_STATE: DashboardState = {
  loading: true,
  error: null,
  data: null,
};

/**
 * Section 2 — Dashboard.
 *
 * Calls the unified `GET /api/admin/dashboard/stats?tab=...&from=...&to=...`
 * endpoint and renders the same KPI grid for every tab. The `detailed` tab
 * additionally includes a per-branch breakdown table.
 */
function useDashboard(tab: Tab, from?: string, to?: string): DashboardState {
  const [state, setState] = useState<DashboardState>(EMPTY_STATE);
  const isAuth = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true, error: null }));
    dashboardApi
      .dashboardStats({ tab, from, to })
      .then((data) => {
        if (cancelled) return;
        setState({ loading: false, error: null, data });
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setState({
          loading: false,
          error: err.message ?? 'Failed to load dashboard',
          data: null,
        });
      });
    return () => {
      cancelled = true;
    };
  }, [tab, from, to, isAuth]);

  return state;
}

interface KpiGridProps {
  loading: boolean;
  stats: dashboardApi.DashboardStats | null;
}

const KpiGrid: React.FC<KpiGridProps> = ({ loading, stats }) => {
  const dash = (n: string | number | null | undefined, fmt: (x: typeof n) => string) =>
    loading ? '—' : fmt(n);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Bets"
          value={dash(stats?.total_bets ?? 0, formatInteger)}
        />
        <StatCard
          title="Total Stakes"
          value={dash(stats?.total_stakes ?? 0, formatCurrency)}
        />
        <StatCard
          title="Paid Bets"
          value={dash(stats?.paid_bets ?? 0, formatInteger)}
        />
        <StatCard
          title="Cancelled Tickets"
          value={dash(stats?.cancelled_tickets ?? 0, formatInteger)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Online Bets"
          value={dash(stats?.online_bets ?? 0, formatInteger)}
        />
        <StatCard
          title="Won Bets"
          value={dash(stats?.won_bets ?? 0, formatInteger)}
        />
        <StatCard
          title="Total Deposits"
          value={dash(stats?.total_deposits ?? 0, formatCurrency)}
        />
        <StatCard
          title="Total Withdrawals"
          value={dash(stats?.total_withdrawals ?? 0, formatCurrency)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Active Branches"
          value={dash(stats?.active_branches ?? 0, formatInteger)}
        />
        <StatCard
          title="Active Users"
          value={dash(stats?.active_users ?? 0, formatInteger)}
        />
        <StatCard
          title="Total Revenue"
          value={dash(stats?.total_revenue ?? 0, formatCurrency)}
        />
        <StatCard
          title="Total Payouts"
          value={dash(stats?.total_payouts ?? 0, formatCurrency)}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Deposit Bonus"
          value={dash(stats?.deposit_bonus ?? 0, formatCurrency)}
        />
        <StatCard
          title="Loyalty Bonus"
          value={dash(stats?.loyalty_bonus ?? 0, formatCurrency)}
        />
        <StatCard
          title="Referral Bonus"
          value={dash(stats?.referral_bonus ?? 0, formatCurrency)}
        />
        <StatCard
          title="Free Bet Bonus"
          value={dash(stats?.free_bet_bonus ?? 0, formatCurrency)}
        />
      </div>
    </div>
  );
};

interface BranchTableRow {
  branch: string;
  total_bets: string;
  total_stakes: string;
  total_payouts: string;
  total_revenue: string;
  active_users: string;
}

const BranchBreakdown: React.FC<{
  rows: dashboardApi.DashboardBranchRow[];
}> = ({ rows }) => {
  const data: BranchTableRow[] = rows.map((r) => ({
    branch: r.branch_name ?? r.branch_code ?? r.branch_id ?? '—',
    total_bets: formatInteger(r.stats.total_bets),
    total_stakes: formatCurrency(r.stats.total_stakes),
    total_payouts: formatCurrency(r.stats.total_payouts),
    total_revenue: formatCurrency(r.stats.total_revenue),
    active_users: formatInteger(r.stats.active_users),
  }));

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center space-x-3 mb-4">
        <Building className="h-5 w-5 text-blue-600" />
        <h3 className="text-lg font-medium text-gray-900">Per-Branch Breakdown</h3>
      </div>
      {data.length === 0 ? (
        <p className="text-sm text-gray-500">
          No active branches in the selected range.
        </p>
      ) : (
        <DataTable<BranchTableRow>
          columns={[
            { header: 'Branch', accessor: 'branch' as const },
            { header: 'Total Bets', accessor: 'total_bets' as const },
            { header: 'Total Stakes', accessor: 'total_stakes' as const },
            { header: 'Total Payouts', accessor: 'total_payouts' as const },
            { header: 'Total Revenue', accessor: 'total_revenue' as const },
            { header: 'Active Users', accessor: 'active_users' as const },
          ]}
          data={data}
        />
      )}
    </div>
  );
};

/**
 * Recent Tickets — small table at the bottom of the dashboard that
 * lists the latest cashier-sold tickets in the current date window.
 * Hits `/api/admin/bets?type=offline&from=…&to=…` directly so it
 * stays in sync with what the Offline Bets page shows.
 */
interface RecentTicketRow {
  id: string;
  code: string;
  stake: string;
  status: string;
  cashier: string;
  branch: string;
  placed: string;
  sold: string;
}

const RecentTickets: React.FC<{ from?: string; to?: string }> = ({
  from,
  to,
}) => {
  const [rows, setRows] = useState<RecentTicketRow[]>([]);
  const [loading, setLoading] = useState(true);
  const isAuth = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    betsApi
      .listBets({ type: 'offline', from, to, limit: 20, page: 1 })
      .then((res) => {
        if (cancelled) return;
        setRows(
          (res.items ?? []).map<RecentTicketRow>((b) => ({
            id: b.id,
            code:
              b.printed_ticket_code ||
              b.coupon_code ||
              b.ticket_code ||
              b.id.slice(0, 8),
            stake: `${Number(b.stake).toFixed(2)} ${b.currency}`,
            status: b.status,
            cashier:
              b.sold_by_cashier_name ??
              b.sold_by_cashier_email ??
              b.cashier_name ??
              b.cashier_email ??
              '—',
            branch:
              b.branch_name ??
              String(
                (b.metadata?.branch_name as string | undefined) ??
                  b.branch_id ??
                  '—'
              ),
            placed: b.placed_at
              ? new Date(b.placed_at).toLocaleString()
              : '—',
            sold: b.sold_at ? new Date(b.sold_at).toLocaleString() : '—',
          }))
        );
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, from, to]);

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center space-x-3 mb-4">
        <Ticket className="h-5 w-5 text-emerald-600" />
        <h3 className="text-lg font-medium text-gray-900">
          Recent Cashier Tickets
        </h3>
      </div>
      {loading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-500">
          No cashier-sold tickets in the selected range.
        </p>
      ) : (
        <DataTable<RecentTicketRow>
          columns={[
            {
              header: 'Ticket',
              accessor: 'code' as const,
              render: (v: string) => (
                <span className="font-mono text-xs">{v}</span>
              ),
            },
            { header: 'Stake', accessor: 'stake' as const },
            {
              header: 'Status',
              accessor: 'status' as const,
              render: (s: string) => {
                const cls =
                  s === 'won'
                    ? 'bg-green-100 text-green-800'
                    : s === 'lost'
                    ? 'bg-gray-100 text-gray-800'
                    : s === 'void' || s === 'cancelled'
                    ? 'bg-red-100 text-red-800'
                    : 'bg-yellow-100 text-yellow-800';
                return (
                  <span
                    className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}
                  >
                    {s.toUpperCase()}
                  </span>
                );
              },
            },
            { header: 'Cashier', accessor: 'cashier' as const },
            { header: 'Branch', accessor: 'branch' as const },
            { header: 'Sold', accessor: 'sold' as const },
            { header: 'Placed', accessor: 'placed' as const },
          ]}
          data={rows}
        />
      )}
    </div>
  );
};

const TabIcon: React.FC<{ tab: Tab }> = ({ tab }) => {
  const map: Record<Tab, React.ComponentType<{ className?: string }>> = {
    summary: TrendingUp,
    offline: Ticket,
    online: Wallet,
    detailed: Building,
  };
  const Icon = map[tab];
  return <Icon className="h-5 w-5 text-gray-400" />;
};

type RangePreset = 'today' | '7d' | '30d' | 'month' | 'all';

export function Dashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('summary');
  // Spec default: today (00:00 → 23:59).
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(() => {
    const d = new Date();
    d.setHours(23, 59, 59, 999);
    return d;
  });

  // Quick range presets. The date pickers still allow any custom range; these
  // just make it obvious how to widen past "today" so recorded data on other
  // days is easy to surface.
  const applyPreset = (preset: RangePreset) => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    if (preset === '7d') start.setDate(start.getDate() - 6);
    else if (preset === '30d') start.setDate(start.getDate() - 29);
    else if (preset === 'month') start.setDate(1);
    else if (preset === 'all') start.setFullYear(start.getFullYear() - 5);
    setStartDate(start);
    setEndDate(end);
  };
  const presets: { id: RangePreset; label: string }[] = [
    { id: 'today', label: 'Today' },
    { id: '7d', label: 'Last 7 Days' },
    { id: '30d', label: 'Last 30 Days' },
    { id: 'month', label: 'This Month' },
    { id: 'all', label: 'All Time' },
  ];

  // Normalise the picked range to whole days: `from` at 00:00:00.000 and `to`
  // at 23:59:59.999. react-datepicker returns a clicked day at midnight, so
  // without this the `to` boundary (t.created_at <= to) drops the entire
  // selected end-day — the report then shows stale data only up to the day
  // before. Full-day boundaries keep the range inclusive.
  const { from, to } = useMemo(() => {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return { from: toIso(start), to: toIso(end) };
  }, [startDate, endDate]);

  const { loading, error, data } = useDashboard(activeTab, from, to);

  useEffect(() => {
    if (error) toast(`Dashboard failed to load: ${error}`, 'error');
  }, [error]);

  const stats = data?.stats ?? null;
  const byBranch = data?.by_branch ?? [];

  const handleExportReport = () => {
    if (!stats) return;
    const rows = [
      { metric: 'Total Bets', value: formatInteger(stats.total_bets) },
      { metric: 'Total Stakes', value: formatCurrency(stats.total_stakes) },
      { metric: 'Paid Bets', value: formatInteger(stats.paid_bets) },
      { metric: 'Cancelled Tickets', value: formatInteger(stats.cancelled_tickets) },
      { metric: 'Online Bets', value: formatInteger(stats.online_bets) },
      { metric: 'Won Bets', value: formatInteger(stats.won_bets) },
      { metric: 'Total Deposits', value: formatCurrency(stats.total_deposits) },
      { metric: 'Total Withdrawals', value: formatCurrency(stats.total_withdrawals) },
      { metric: 'Active Branches', value: formatInteger(stats.active_branches) },
      { metric: 'Active Users', value: formatInteger(stats.active_users) },
      { metric: 'Deposit Bonus', value: formatCurrency(stats.deposit_bonus) },
      { metric: 'Loyalty Bonus', value: formatCurrency(stats.loyalty_bonus) },
      { metric: 'Referral Bonus', value: formatCurrency(stats.referral_bonus) },
      { metric: 'Free Bet Bonus', value: formatCurrency(stats.free_bet_bonus) },
      { metric: 'Total Revenue', value: formatCurrency(stats.total_revenue) },
      { metric: 'Total Payouts', value: formatCurrency(stats.total_payouts) },
    ];
    downloadCsv(
      [
        { header: 'Metric', accessor: 'metric' as const },
        { header: 'Value', accessor: 'value' as const },
      ],
      rows,
      `dashboard-${activeTab}-${todayStamp()}`
    );
    toast('Dashboard report exported.');
  };

  // Hint icons (currently rendered above in the design as decorative; we
  // keep the import alive so future tabs can reuse the icon set without
  // additional imports).
  void DollarSign;
  void ArrowUpDown;
  void Users;
  void Gift;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:justify-between lg:items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-4">
          <div className="flex flex-wrap items-center gap-1">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => applyPreset(p.id)}
                className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-gray-300 text-gray-700 bg-white hover:bg-gray-50"
              >
                {p.label}
              </button>
            ))}
          </div>
          <DateRangePicker
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />
          <button
            onClick={handleExportReport}
            disabled={!stats || loading}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
          >
            Export Report
          </button>
        </div>
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as Tab)}
      />

      <div className="flex items-center space-x-2 text-sm text-gray-600">
        <TabIcon tab={activeTab} />
        <span>
          Showing <strong className="text-gray-900">
            {tabs.find((t) => t.id === activeTab)?.label}
          </strong>
          {data?.range && (
            <>
              {' '}for{' '}
              <span className="text-gray-700">
                {new Date(data.range.from).toLocaleDateString()} →{' '}
                {new Date(data.range.to).toLocaleDateString()}
              </span>
            </>
          )}
        </span>
      </div>

      <div className="mt-2">
        <KpiGrid loading={loading} stats={stats} />

        {activeTab === 'detailed' && !loading && (
          <div className="mt-6">
            <BranchBreakdown rows={byBranch} />
          </div>
        )}

        {/* Recent cashier-sold tickets — only relevant on tabs that
            include offline activity (summary / offline / detailed). The
            Online tab is online-only, so hide the table there. */}
        {activeTab !== 'online' && (
          <div className="mt-6">
            <RecentTickets from={from} to={to} />
          </div>
        )}
      </div>
    </div>
  );
}
