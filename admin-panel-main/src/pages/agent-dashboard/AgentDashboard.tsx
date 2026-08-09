/**
 * Agent Dashboard (`/agent-dashboard`).
 *
 * Agent-scoped shop KPIs + ticket list backed by
 * `GET /api/admin/agent-dashboard` and `/agent-dashboard/tickets`.
 *
 * KPIs: Cashier Deposit · Withdrawal · Shop Stake · Paid Out · Net Profit ·
 * Won Tickets · Lost Tickets.
 *
 * Ticket list: the same columns as the admin Offline Bets page, but every
 * row is restricted to the signed-in agent's own sub-tree (their branches +
 * sales staff). Super admins / admins see the aggregate of all shops.
 *
 * Filters (shared by KPIs + ticket list): date range + Branch + Sales.
 * The ticket list adds Status + Ticket/Bet-ID search.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Eye, X } from 'lucide-react';
import { FilterBar } from '../../components/FilterBar';
import { DataTable } from '../../components/DataTable';
import { toast } from '../../lib/toast';
import { useAuthStore } from '../../store/auth';
import {
  agentDashboard,
  agentTickets,
  agentTicketDetail,
  type AgentDashboardResponse,
  type AgentTicketRow,
  type AgentTicketDetail,
} from '../../lib/api/agentDashboard';

const fmt = (n: string | number | null | undefined) => {
  const v = typeof n === 'string' ? Number(n) : (n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const dayStart = (d: Date) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const dayEnd = (d: Date) => {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
};

const num = (s: string | number | null | undefined): number =>
  typeof s === 'number' ? s : Number(s ?? 0);

const STATUS_TO_LABEL: Record<string, string> = {
  pending: 'Pending',
  won: 'Won',
  lost: 'Lost',
  void: 'Cancelled',
  cancelled: 'Cancelled',
  cashout: 'Cashout',
  partial: 'Partial',
};
const LABEL_TO_STATUS: Record<string, string> = {
  Pending: 'pending',
  Won: 'won',
  Lost: 'lost',
  Cancelled: 'cancelled',
  Cashout: 'cashout',
  Partial: 'partial',
};

interface TicketRow {
  id: string;
  fullName: string;
  phoneNumber: string;
  stake: number;
  won: number;
  bonus: number;
  netWin: number;
  betId: string;
  ticketCode: string;
  paid: string;
  status: string;
  paymentType: string;
  paidAmount: number;
  paidAt: string;
  soldAt: string;
  date: string;
  branch: string;
  cashier: string;
}

function toTicketRow(t: AgentTicketRow): TicketRow {
  const md = (t.metadata ?? {}) as Record<string, unknown>;
  const stake = num(t.stake);
  const payout = num(t.actual_payout);
  const won = t.status === 'won' ? payout : 0;
  const bonus = num((md.bonus_used as number | string | undefined) ?? 0);
  const netWin = won - bonus;
  return {
    id: t.id,
    fullName: String((md.full_name as string | undefined) ?? t.user_name ?? '—'),
    phoneNumber: t.bet_for_user_phone ?? t.user_phone ?? '—',
    stake,
    won,
    bonus,
    netWin: Number.isFinite(netWin) ? netWin : 0,
    betId: t.id.slice(0, 8),
    ticketCode:
      t.printed_ticket_code || t.coupon_code || t.ticket_code || t.id.slice(0, 8),
    paid: t.status === 'won' && payout > 0 ? 'Yes' : 'No',
    status: STATUS_TO_LABEL[t.status] ?? t.status,
    paymentType: String((md.payment_type as string | undefined) ?? 'Cash'),
    paidAmount: t.status === 'won' ? payout : 0,
    paidAt: t.settled_at ? new Date(t.settled_at).toLocaleString() : '—',
    soldAt: t.sold_at ? new Date(t.sold_at).toLocaleString() : '—',
    date: t.placed_at ? new Date(t.placed_at).toLocaleString() : '—',
    branch:
      t.branch_name ??
      String((md.branch_name as string | undefined) ?? t.branch_id ?? '—'),
    cashier:
      t.sold_by_cashier_name ??
      t.sold_by_cashier_email ??
      t.cashier_name ??
      t.cashier_email ??
      String((md.cashier_name as string | undefined) ?? '—'),
  };
}

export function AgentDashboard() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);

  const [startDate, setStartDate] = useState<Date>(() => new Date());
  const [endDate, setEndDate] = useState<Date>(() => new Date());
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [selectedSalesId, setSelectedSalesId] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [search, setSearch] = useState('');

  const [data, setData] = useState<AgentDashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const [tickets, setTickets] = useState<AgentTicketRow[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [ticketTotal, setTicketTotal] = useState(0);

  const [slip, setSlip] = useState<{
    bet: AgentTicketDetail | null;
    loading: boolean;
  } | null>(null);

  const fromIso = dayStart(startDate).toISOString();
  const toIso = dayEnd(endDate).toISOString();

  // KPIs
  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    agentDashboard({
      from: fromIso,
      to: toIso,
      branch_id: selectedBranchId || undefined,
      sales_id: selectedSalesId || undefined,
    })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: Error) =>
        toast(`Failed to load dashboard: ${err.message}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, fromIso, toIso, selectedBranchId, selectedSalesId]);

  // Ticket list
  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setTicketsLoading(true);
    agentTickets({
      from: fromIso,
      to: toIso,
      branch_id: selectedBranchId || undefined,
      sales_id: selectedSalesId || undefined,
      status: LABEL_TO_STATUS[selectedStatus] || undefined,
      search: search.trim() || undefined,
      limit: 200,
    })
      .then((res) => {
        if (cancelled) return;
        setTickets(res.items ?? []);
        setTicketTotal(res.total ?? 0);
      })
      .catch((err: Error) =>
        toast(`Failed to load tickets: ${err.message}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setTicketsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    isAuth,
    fromIso,
    toIso,
    selectedBranchId,
    selectedSalesId,
    selectedStatus,
    search,
  ]);

  const totals = data?.totals;
  const branchOpts = useMemo(() => data?.branches ?? [], [data]);
  const salesOpts = useMemo(() => data?.sales ?? [], [data]);
  const ticketRows = useMemo(() => tickets.map(toTicketRow), [tickets]);

  const selectedBranchLabel =
    branchOpts.find((b) => b.id === selectedBranchId)?.label ?? '';
  const selectedSalesLabel =
    salesOpts.find((s) => s.id === selectedSalesId)?.label ?? '';

  const filters = [
    {
      label: 'Branch',
      options: branchOpts.map((b) => b.label),
      value: selectedBranchLabel,
      onChange: (val: string) => {
        const match = branchOpts.find((b) => b.label === val);
        setSelectedBranchId(match ? match.id : '');
      },
    },
    {
      label: 'Sales',
      options: salesOpts.map((s) => s.label),
      value: selectedSalesLabel,
      onChange: (val: string) => {
        const match = salesOpts.find((s) => s.label === val);
        setSelectedSalesId(match ? match.id : '');
      },
    },
    {
      label: 'Status',
      options: ['Pending', 'Won', 'Lost', 'Cancelled', 'Cashout'],
      value: selectedStatus,
      onChange: setSelectedStatus,
    },
    {
      label: 'Ticket / Bet ID',
      options: [] as string[],
      value: search,
      onChange: setSearch,
      type: 'text' as const,
    },
  ];

  const handleClearFilters = () => {
    setSelectedBranchId('');
    setSelectedSalesId('');
    setSelectedStatus('');
    setSearch('');
    setStartDate(new Date());
    setEndDate(new Date());
  };

  const handleViewSlip = async (id: string) => {
    setSlip({ bet: null, loading: true });
    try {
      const detail = await agentTicketDetail(id);
      setSlip({ bet: detail, loading: false });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load slip';
      toast(msg, 'error');
      setSlip(null);
    }
  };

  const netProfit = Number(totals?.net_profit ?? 0);

  const columns = [
    {
      header: 'Ticket Code',
      accessor: 'ticketCode' as const,
      render: (v: string) => <span className="font-mono text-xs">{v}</span>,
    },
    { header: 'Full Name', accessor: 'fullName' as const },
    { header: 'Phone', accessor: 'phoneNumber' as const },
    { header: 'Branch', accessor: 'branch' as const },
    { header: 'Cashier', accessor: 'cashier' as const },
    { header: 'Stake', accessor: 'stake' as const, render: (v: number) => v.toFixed(2) },
    { header: 'Won Amount', accessor: 'won' as const, render: (v: number) => v.toFixed(2) },
    { header: 'Bonus Used', accessor: 'bonus' as const, render: (v: number) => v.toFixed(2) },
    { header: 'Net Win', accessor: 'netWin' as const, render: (v: number) => v.toFixed(2) },
    { header: 'Bet ID', accessor: 'betId' as const },
    { header: 'Sold At', accessor: 'soldAt' as const },
    { header: 'Paid', accessor: 'paid' as const },
    {
      header: 'Status',
      accessor: 'status' as const,
      render: (s: string) => {
        const cls =
          s === 'Won'
            ? 'bg-green-100 text-green-800'
            : s === 'Lost'
              ? 'bg-gray-100 text-gray-800'
              : s === 'Cancelled'
                ? 'bg-red-100 text-red-800'
                : 'bg-yellow-100 text-yellow-800';
        return (
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${cls}`}>
            {s}
          </span>
        );
      },
    },
    { header: 'Payment Type', accessor: 'paymentType' as const },
    {
      header: 'Paid Amount',
      accessor: 'paidAmount' as const,
      render: (v: number) => v.toFixed(2),
    },
    { header: 'Paid At', accessor: 'paidAt' as const },
    { header: 'Date', accessor: 'date' as const },
    {
      header: 'Actions',
      accessor: 'id' as const,
      render: (id: string) => (
        <button
          onClick={() => handleViewSlip(id)}
          className="text-blue-600 hover:text-blue-800"
          title="View Slip"
        >
          <Eye className="h-4 w-4" />
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">Dashboard</h1>
        {loading && <span className="text-xs text-gray-500">Loading…</span>}
      </div>

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
        onClear={handleClearFilters}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Cashier Deposit" value={fmt(totals?.cashier_deposit)} />
        <StatCard label="Total Withdrawal" value={fmt(totals?.withdrawal)} tone="negative" />
        <StatCard label="Total Shop Stake" value={fmt(totals?.shop_stake)} />
        <StatCard label="Total Paid Out" value={fmt(totals?.paid_out)} tone="negative" />
        <StatCard
          label="Net Profit"
          value={fmt(totals?.net_profit)}
          tone={netProfit >= 0 ? 'positive' : 'negative'}
        />
        <StatCard label="Total Won Tickets" value={fmt(totals?.won_tickets)} />
        <StatCard label="Total Lost Tickets" value={fmt(totals?.lost_tickets)} />
        <StatCard label="Total Tickets" value={fmt(totals?.total_tickets)} />
      </div>

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Ticket List</h2>
        <span className="text-xs text-gray-500">
          {ticketTotal.toLocaleString()} ticket(s)
        </span>
      </div>

      <div className="bg-white rounded-lg shadow">
        <DataTable columns={columns} data={ticketRows} />
        {ticketsLoading && (
          <div className="px-6 pb-6 text-sm text-gray-500">Loading tickets…</div>
        )}
      </div>

      {slip && (
        <SlipModal
          data={slip}
          onClose={() => setSlip(null)}
        />
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive' | 'negative';
}) {
  const cls =
    tone === 'positive'
      ? 'text-green-700'
      : tone === 'negative'
        ? 'text-red-700'
        : 'text-gray-900';
  return (
    <div className="bg-white p-4 rounded-lg shadow-sm">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</p>
    </div>
  );
}

const Field = ({ label, value }: { label: string; value: string }) => (
  <div>
    <p className="text-sm text-gray-500">{label}</p>
    <p className="font-medium break-all">{value}</p>
  </div>
);

function SlipModal({
  data,
  onClose,
}: {
  data: { bet: AgentTicketDetail | null; loading: boolean };
  onClose: () => void;
}) {
  const bet = data.bet;
  const totalOdds = bet
    ? bet.legs.reduce(
        (acc, leg) =>
          acc *
          (Number(leg.odds_at_placement ?? leg.current_odds ?? 1) || 1),
        1
      ) || 1
    : 1;
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-5xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-semibold">Ticket Slip</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <X className="h-5 w-5" />
            </button>
          </div>
          {data.loading || !bet ? (
            <div className="py-10 text-center text-sm text-gray-500">
              Loading slip…
            </div>
          ) : (
            <div className="space-y-6">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="Printed Ticket" value={bet.printed_ticket_code ?? '—'} />
                <Field label="Coupon Code" value={bet.coupon_code ?? '—'} />
                <Field label="Ticket Code" value={bet.ticket_code ?? '—'} />
                <Field label="Bet ID" value={bet.id} />
                <Field
                  label="Cashier"
                  value={String(
                    bet.sold_by_cashier_name ??
                      bet.sold_by_cashier_email ??
                      bet.cashier_name ??
                      bet.cashier_email ??
                      '—'
                  )}
                />
                <Field label="Branch" value={String(bet.branch_name ?? '—')} />
                <Field label="Status" value={bet.status} />
                <Field
                  label="Sold At"
                  value={bet.sold_at ? new Date(bet.sold_at).toLocaleString() : '—'}
                />
                <Field
                  label="Paid At"
                  value={bet.paid_at ? new Date(bet.paid_at).toLocaleString() : '—'}
                />
              </div>

              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      {['Match', 'League', 'Sport', 'Market', 'Selection', 'Odds', 'Result'].map(
                        (h) => (
                          <th
                            key={h}
                            className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase"
                          >
                            {h}
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {bet.legs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-3 text-sm text-gray-500 text-center">
                          No legs recorded for this ticket.
                        </td>
                      </tr>
                    ) : (
                      bet.legs.map((leg) => (
                        <tr key={leg.id}>
                          <td className="px-4 py-2 text-sm">
                            {leg.home_team && leg.away_team
                              ? `${leg.home_team} vs ${leg.away_team}`
                              : '—'}
                          </td>
                          <td className="px-4 py-2 text-sm">{leg.league ?? '—'}</td>
                          <td className="px-4 py-2 text-sm">{leg.sport ?? '—'}</td>
                          <td className="px-4 py-2 text-sm">
                            {leg.market_label ?? leg.market_type ?? '—'}
                          </td>
                          <td className="px-4 py-2 text-sm">{leg.selection_label ?? '—'}</td>
                          <td className="px-4 py-2 text-sm">
                            {Number(leg.odds_at_placement ?? leg.current_odds ?? 0).toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-sm">{leg.result ?? leg.status}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-gray-50 p-4 rounded-lg">
                <Field label="Stake" value={num(bet.stake).toFixed(2)} />
                <Field label="Number of Bets" value={String(bet.legs.length)} />
                <Field label="Total Odds" value={totalOdds.toFixed(2)} />
                <Field label="Payout" value={num(bet.actual_payout).toFixed(2)} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default AgentDashboard;
