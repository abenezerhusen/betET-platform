/**
 * Payable Report (`/reports/payable`).
 *
 * Section 6 of the platform spec — what the platform owes to agents,
 * branches, and sales reps. Backed by:
 *
 *   GET   /api/admin/reports/payable?scope=daily|agent|branch|sales
 *   PATCH /api/admin/reports/payable/:id/approve
 *   PATCH /api/admin/reports/payable/:id/reject
 *   PATCH /api/admin/reports/payable/:id/mark-paid
 *
 * Commission rates (per-tenant defaults for each scope) are also editable
 * from this page via:
 *
 *   GET /api/admin/reports/payable/commission-rates
 *   PUT /api/admin/reports/payable/commission-rates
 *
 * Status lifecycle: Pending → Approved → Paid (or Pending → Rejected).
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Check, FileDown, Settings as SettingsIcon, X } from 'lucide-react';
import { TabGroup } from '../../components/TabGroup';
import { FilterBar } from '../../components/FilterBar';
import { DataTable } from '../../components/DataTable';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import { useAuthStore } from '../../store/auth';
import { reports } from '../../lib/api';

type ScopeId = reports.PayableScope;

const tabs: { id: ScopeId; label: string }[] = [
  { id: 'daily', label: 'Daily Payable' },
  { id: 'agent', label: 'Agent Payable' },
  { id: 'branch', label: 'Branch Payable' },
  { id: 'sales', label: 'Sales Payable' },
];

const fmt = (n: string | number | null | undefined) => {
  const v = typeof n === 'string' ? Number(n) : (n ?? 0);
  if (!Number.isFinite(v)) return '0';
  return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
};

const toIso = (d: Date) => d.toISOString();

const statusStyles: Record<reports.PayableStatus, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
  paid: 'bg-green-100 text-green-800',
};

export function PayableReport() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const role = useAuthStore((s) => s.user?.role);
  const canView = role === 'admin' || role === 'superadmin';
  const canDecide = role === 'admin' || role === 'superadmin';

  const [activeTab, setActiveTab] = useState<ScopeId>('daily');
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 13);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [statusFilter, setStatusFilter] = useState('');
  const [data, setData] = useState<reports.PayableResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showRates, setShowRates] = useState(false);

  useEffect(() => {
    if (!isAuth || !canView) return;
    let cancelled = false;
    setLoading(true);
    reports
      .payableReport({
        scope: activeTab,
        from: toIso(startDate),
        to: toIso(endDate),
        status: (statusFilter || undefined) as reports.PayableStatus | undefined,
      })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err: Error) =>
        toast(`Failed to load payable report: ${err.message}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, canView, activeTab, startDate, endDate, statusFilter, refreshKey]);

  const items = data?.items ?? [];
  const summary = data?.summary;

  const filters = [
    {
      label: 'Status',
      options: ['pending', 'approved', 'rejected', 'paid'],
      value: statusFilter,
      onChange: setStatusFilter,
    },
  ];

  const decide = async (
    id: string,
    action: 'approve' | 'reject' | 'mark-paid'
  ) => {
    try {
      if (action === 'approve') await reports.approvePayable(id);
      else if (action === 'reject') await reports.rejectPayable(id);
      else await reports.markPayablePaid(id);
      toast(
        action === 'approve'
          ? 'Payable approved.'
          : action === 'reject'
            ? 'Payable rejected.'
            : 'Payable marked as paid.',
        'success'
      );
      setRefreshKey((k) => k + 1);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Action failed';
      toast(message, 'error');
    }
  };

  const columns = useMemo(() => {
    const base: Array<{
      header: string;
      accessor: keyof reports.PayableRecord;
      render?: (
        value: unknown,
        row: reports.PayableRecord
      ) => React.ReactNode;
    }> = [
      { header: 'Date', accessor: 'period_date' as const },
    ];
    if (activeTab !== 'daily') {
      base.push({
        header:
          activeTab === 'agent'
            ? 'Agent'
            : activeTab === 'branch'
              ? 'Branch'
              : 'Sales',
        accessor: 'entity_label' as const,
      });
    }
    base.push({
      header: 'Stakes',
      accessor: 'total_stakes' as const,
      render: (v: unknown) => fmt(v as string),
    });
    base.push({
      header: 'Payouts',
      accessor: 'total_payouts' as const,
      render: (v: unknown) => fmt(v as string),
    });
    if (activeTab !== 'daily') {
      base.push({
        header: 'Rate %',
        accessor: 'commission_rate' as const,
        render: (v: unknown) => (v == null ? '—' : `${fmt(v as number)}%`),
      });
    }
    base.push({
      header: 'Total Payable',
      accessor: 'total_payable' as const,
      render: (v: unknown) => fmt(v as string),
    });
    base.push({
      header: 'Status',
      accessor: 'status' as const,
      render: (v: unknown) => (
        <span
          className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${statusStyles[v as reports.PayableStatus]}`}
        >
          {String(v)}
        </span>
      ),
    });
    if (canDecide) {
      base.push({
        header: 'Action',
        accessor: 'id' as const,
        render: (_v: unknown, row: reports.PayableRecord) => {
          if (row.status === 'pending') {
            return (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => decide(row.id, 'approve')}
                  className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-md text-green-700 bg-green-50 hover:bg-green-100"
                >
                  <Check size={12} className="mr-1" /> Approve
                </button>
                <button
                  onClick={() => decide(row.id, 'reject')}
                  className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-md text-red-700 bg-red-50 hover:bg-red-100"
                >
                  <X size={12} className="mr-1" /> Reject
                </button>
              </div>
            );
          }
          if (row.status === 'approved') {
            return (
              <button
                onClick={() => decide(row.id, 'mark-paid')}
                className="inline-flex items-center px-2 py-1 text-xs font-medium rounded-md text-blue-700 bg-blue-50 hover:bg-blue-100"
              >
                Mark Paid
              </button>
            );
          }
          return <span className="text-xs text-gray-400">—</span>;
        },
      });
    }
    return base;
  }, [activeTab, canDecide]);

  const handleExport = () => {
    if (items.length === 0) {
      toast('No rows to export.', 'error');
      return;
    }
    const exportCols = columns
      .filter((c) => c.header !== 'Action')
      .map((c) => ({ header: c.header, accessor: c.accessor }));
    downloadCsv(exportCols, items, `payable-${activeTab}-${todayStamp()}`);
    toast(`Exported ${items.length} rows (${activeTab}).`, 'success');
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
        <h1 className="text-2xl font-semibold text-gray-900">Payable Report</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowRates(true)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <SettingsIcon className="h-4 w-4 mr-2" />
            Commission Rates
          </button>
          <button
            onClick={handleExport}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Report
          </button>
        </div>
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
        onClear={() => {
          setStatusFilter('');
          setStartDate(() => {
            const d = new Date();
            d.setDate(d.getDate() - 13);
            return d;
          });
          setEndDate(new Date());
        }}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <SummaryCard label="Total Payable" value={fmt(summary?.total)} />
        <SummaryCard
          label="Pending"
          value={fmt(summary?.pending)}
          tone="warning"
        />
        <SummaryCard
          label="Approved"
          value={fmt(summary?.approved)}
          tone="info"
        />
        <SummaryCard
          label="Rejected"
          value={fmt(summary?.rejected)}
          tone="negative"
        />
        <SummaryCard label="Paid" value={fmt(summary?.paid)} tone="positive" />
      </div>

      <div className="bg-white rounded-lg shadow">
        <DataTable columns={columns} data={items} />
        {loading && (
          <div className="px-4 py-3 text-xs text-gray-500">Loading…</div>
        )}
      </div>

      {showRates && data && (
        <CommissionRatesModal
          initial={data.commission_rates}
          onClose={() => setShowRates(false)}
          onSaved={() => {
            setShowRates(false);
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
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
  tone?: 'positive' | 'negative' | 'warning' | 'info';
}) {
  const cls =
    tone === 'positive'
      ? 'text-green-700'
      : tone === 'negative'
        ? 'text-red-700'
        : tone === 'warning'
          ? 'text-yellow-700'
          : tone === 'info'
            ? 'text-blue-700'
            : 'text-gray-900';
  return (
    <div className="bg-white p-4 rounded-lg shadow-sm">
      <p className="text-xs uppercase text-gray-500">{label}</p>
      <p className={`text-xl font-semibold ${cls}`}>{value}</p>
    </div>
  );
}

function CommissionRatesModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: reports.CommissionRates;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [agent, setAgent] = useState(String(initial.agent));
  const [branch, setBranch] = useState(String(initial.branch));
  const [sales, setSales] = useState(String(initial.sales));
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const parsed = {
      agent: Number(agent),
      branch: Number(branch),
      sales: Number(sales),
    };
    if (
      [parsed.agent, parsed.branch, parsed.sales].some(
        (n) => !Number.isFinite(n) || n < 0 || n > 100
      )
    ) {
      toast('Each rate must be a number between 0 and 100.', 'error');
      return;
    }
    try {
      setSaving(true);
      await reports.setCommissionRates(parsed);
      toast('Commission rates updated.', 'success');
      onSaved();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save';
      toast(message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Commission Rates
        </h2>
        <p className="text-xs text-gray-500 mb-4">
          Default percentage applied to ticket sales when computing payable
          totals. Per-user overrides via <code>users.metadata.commission_rate</code>{' '}
          take precedence.
        </p>
        <div className="space-y-3">
          <RateInput label="Agent" value={agent} onChange={setAgent} />
          <RateInput label="Branch" value={branch} onChange={setBranch} />
          <RateInput label="Sales" value={sales} onChange={setSales} />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={saving}
            className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RateInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600 uppercase">
        {label}
      </span>
      <div className="relative mt-1">
        <input
          type="number"
          min={0}
          max={100}
          step={0.1}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-blue-500 pr-8"
        />
        <span className="absolute right-3 top-2 text-sm text-gray-400">%</span>
      </div>
    </label>
  );
}
