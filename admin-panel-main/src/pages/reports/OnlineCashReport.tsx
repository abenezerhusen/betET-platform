/**
 * Online Cash Report (`/reports/online-cash`).
 *
 * Section 6 of the platform spec — "financial summary of all online betting
 * activity" backed by `GET /api/admin/reports/online-cash`.
 *
 * Shown on the page:
 *   - Summary KPI cards (total stakes, total payouts, net revenue,
 *     bonus cost, bets placed, paid bets).
 *   - Per-day breakdown (table).
 *   - Per-sport breakdown (table) — uses the `casino` bucket for the
 *     unified `bets` table rows.
 *
 * Filters:
 *   - Date range
 *   - Sport (free-text; the backend filters via leg → market → event.sport)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { FileDown } from 'lucide-react';
import { FilterBar } from '../../components/FilterBar';
import { DataTable } from '../../components/DataTable';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import { useAuthStore } from '../../store/auth';
import { reports } from '../../lib/api';

const fmt = (n: string | number | null | undefined) => {
  const v = typeof n === 'string' ? Number(n) : (n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const toIso = (d: Date) => d.toISOString();

const dayColumns = [
  { header: 'Date', accessor: 'day' as const },
  { header: 'Bets', accessor: 'bets' as const, render: (v: number) => fmt(v) },
  { header: 'Stakes', accessor: 'stakes' as const, render: (v: string) => fmt(v) },
  { header: 'Payouts', accessor: 'payouts' as const, render: (v: string) => fmt(v) },
  { header: 'Net Revenue', accessor: 'net' as const, render: (v: string) => fmt(v) },
];

const sportColumns = [
  { header: 'Sport', accessor: 'sport' as const },
  { header: 'Bets', accessor: 'bets' as const, render: (v: number) => fmt(v) },
  { header: 'Stakes', accessor: 'stakes' as const, render: (v: string) => fmt(v) },
  { header: 'Payouts', accessor: 'payouts' as const, render: (v: string) => fmt(v) },
  { header: 'Net Revenue', accessor: 'net' as const, render: (v: string) => fmt(v) },
];

export function OnlineCashReport() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  // Spec: Super Admin, Admin (finance role) — keep it broad to admin/superadmin
  // since "finance" sub-role isn't a hard gate yet.
  const canView = role === 'admin' || role === 'superadmin';

  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 29);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [sport, setSport] = useState('');

  const [data, setData] = useState<reports.OnlineCashResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuth || !canView) return;
    let cancelled = false;
    setLoading(true);
    reports
      .onlineCashReport({
        from: toIso(startDate),
        to: toIso(endDate),
        sport: sport || undefined,
      })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: Error) =>
        toast(`Failed to load online cash report: ${err.message}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, canView, startDate, endDate, sport]);

  const summary = data?.summary;
  const byDay = useMemo(() => data?.by_day ?? [], [data]);
  const bySport = useMemo(() => data?.by_sport ?? [], [data]);

  const sportOptions = useMemo(
    () => Array.from(new Set(bySport.map((r) => r.sport).filter(Boolean))),
    [bySport]
  );

  const filters = [
    {
      label: 'Sport',
      options: sportOptions,
      value: sport,
      onChange: setSport,
    },
  ];

  const handleExport = () => {
    if (byDay.length === 0) {
      toast('Nothing to export for the current filters.', 'error');
      return;
    }
    downloadCsv(
      dayColumns.map((c) => ({ header: c.header, accessor: c.accessor })),
      byDay,
      `online-cash-${todayStamp()}`
    );
    toast(`Exported ${byDay.length} rows.`, 'success');
  };

  if (!canView) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-600">
          You do not have permission to view this report.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-semibold text-gray-900">
          Online Cash Report
        </h1>
        <button
          onClick={handleExport}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Export Report
        </button>
      </div>

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <SummaryCard label="Total Stakes" value={fmt(summary?.total_stakes)} />
        <SummaryCard
          label="Total Payouts"
          value={fmt(summary?.total_payouts)}
          tone="negative"
        />
        <SummaryCard
          label="Net Revenue"
          value={fmt(summary?.net_revenue)}
          tone="positive"
        />
        <SummaryCard label="Bonus Cost" value={fmt(summary?.bonus_cost)} />
        <SummaryCard label="Bets Placed" value={fmt(summary?.bets_placed)} />
        <SummaryCard label="Paid Bets" value={fmt(summary?.paid_bets)} />
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-gray-700 uppercase">
            Per-day breakdown
          </h2>
        </div>
        <DataTable columns={dayColumns} data={byDay} />
        {loading && (
          <div className="px-4 py-3 text-xs text-gray-500">Loading…</div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold text-gray-700 uppercase">
            Per-sport breakdown
          </h2>
        </div>
        <DataTable columns={sportColumns} data={bySport} />
      </div>
    </div>
  );
}

function SummaryCard({
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
      <p className={`text-xl font-semibold ${cls}`}>{value}</p>
    </div>
  );
}
