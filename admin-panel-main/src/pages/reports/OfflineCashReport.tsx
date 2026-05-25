/**
 * Offline Cash Report (`/reports/offline-cash`).
 *
 * Section 6 of the platform spec — "financial summary of all cashier/branch
 * betting activity" backed by `GET /api/admin/reports/offline-cash`.
 *
 * Two tabs surface the same dataset:
 *   - Branch view: one row per branch (tickets sold / paid / net).
 *   - Cashier view: one row per cashier (within a branch when scoped).
 *
 * Filters: date range + branch + cashier (free-text id; branch dropdown is
 * derived from the branch breakdown returned in the same response).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { FileDown } from 'lucide-react';
import { TabGroup } from '../../components/TabGroup';
import { FilterBar } from '../../components/FilterBar';
import { DataTable } from '../../components/DataTable';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import { useAuthStore } from '../../store/auth';
import { reports } from '../../lib/api';

type ScopeId = 'branch' | 'cashier';

const tabs: { id: ScopeId; label: string }[] = [
  { id: 'branch', label: 'By Branch' },
  { id: 'cashier', label: 'By Cashier' },
];

const fmt = (n: string | number | null | undefined) => {
  const v = typeof n === 'string' ? Number(n) : (n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const toIso = (d: Date) => d.toISOString();

const branchColumns = [
  { header: 'Branch', accessor: 'branch_name' as const },
  { header: 'Code', accessor: 'branch_code' as const },
  { header: 'Tickets', accessor: 'bets' as const, render: (v: number) => fmt(v) },
  { header: 'Stakes', accessor: 'stakes' as const, render: (v: string) => fmt(v) },
  { header: 'Payouts', accessor: 'payouts' as const, render: (v: string) => fmt(v) },
  { header: 'Net', accessor: 'net' as const, render: (v: string) => fmt(v) },
];

const cashierColumns = [
  { header: 'Branch', accessor: 'branch_name' as const },
  { header: 'Cashier', accessor: 'cashier_name' as const },
  { header: 'Phone', accessor: 'cashier_phone' as const },
  { header: 'Tickets', accessor: 'bets' as const, render: (v: number) => fmt(v) },
  { header: 'Stakes', accessor: 'stakes' as const, render: (v: string) => fmt(v) },
  { header: 'Payouts', accessor: 'payouts' as const, render: (v: string) => fmt(v) },
  { header: 'Net', accessor: 'net' as const, render: (v: string) => fmt(v) },
];

export function OfflineCashReport() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  const canView = role === 'admin' || role === 'superadmin';

  const [activeTab, setActiveTab] = useState<ScopeId>('branch');
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 13);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [cashierId, setCashierId] = useState('');

  const [data, setData] = useState<reports.OfflineCashResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuth || !canView) return;
    let cancelled = false;
    setLoading(true);
    reports
      .offlineCashReport({
        from: toIso(startDate),
        to: toIso(endDate),
        branch_id: selectedBranchId || undefined,
        cashier_id: cashierId || undefined,
      })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: Error) =>
        toast(`Failed to load offline cash report: ${err.message}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, canView, startDate, endDate, selectedBranchId, cashierId]);

  const summary = data?.summary;
  const byBranch = useMemo(() => data?.by_branch ?? [], [data]);
  const byCashier = useMemo(() => data?.by_cashier ?? [], [data]);

  const branchByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of byBranch) {
      if (b.branch_id) map.set(b.branch_name, b.branch_id);
    }
    return map;
  }, [byBranch]);

  const branchOptions = useMemo(
    () => Array.from(branchByName.keys()),
    [branchByName]
  );

  const selectedBranchName =
    Array.from(branchByName.entries()).find(
      ([, id]) => id === selectedBranchId
    )?.[0] ?? '';

  const filters = [
    {
      label: 'Branch',
      options: branchOptions,
      value: selectedBranchName,
      onChange: (val: string) =>
        setSelectedBranchId(val ? (branchByName.get(val) ?? '') : ''),
    },
    {
      label: 'Cashier ID',
      options: [] as string[],
      value: cashierId,
      onChange: setCashierId,
      type: 'text' as const,
    },
  ];

  const handleExport = () => {
    const cols = activeTab === 'branch' ? branchColumns : cashierColumns;
    const rows = activeTab === 'branch' ? byBranch : byCashier;
    if (rows.length === 0) {
      toast('Nothing to export for the current filters.', 'error');
      return;
    }
    downloadCsv(
      cols.map((c) => ({ header: c.header, accessor: c.accessor })),
      rows,
      `offline-cash-${activeTab}-${todayStamp()}`
    );
    toast(`Exported ${rows.length} rows.`, 'success');
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
          Offline Cash Report
        </h1>
        <button
          onClick={handleExport}
          className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
        >
          <FileDown className="h-4 w-4 mr-2" />
          Export Report
        </button>
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(id) => setActiveTab(id as ScopeId)}
      />

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
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
        <SummaryCard label="Tickets Sold" value={fmt(summary?.bets_placed)} />
        <SummaryCard label="Paid Tickets" value={fmt(summary?.paid_bets)} />
      </div>

      <div className="bg-white rounded-lg shadow">
        <DataTable
          columns={activeTab === 'branch' ? branchColumns : cashierColumns}
          data={activeTab === 'branch' ? byBranch : byCashier}
        />
        {loading && (
          <div className="px-4 py-3 text-xs text-gray-500">Loading…</div>
        )}
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
