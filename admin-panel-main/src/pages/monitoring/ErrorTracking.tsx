import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import {
  AlertTriangle,
  XCircle,
  AlertOctagon,
  FileDown,
  RefreshCw,
  BarChart2,
  Clock,
} from 'lucide-react';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
// Section 10 — Error Tracking reads from /api/admin/logs/errors; the
// row shape is identical to the legacy monitoring/errors response, but
// we keep `monitoringApi.resolveError` for the existing resolve button
// since that mutation hasn't been re-aliased.
import * as logsApi from '../../lib/api/logs';
import * as monitoringApi from '../../lib/api/monitoring';
import { useAuthStore } from '../../store/auth';
import { toIso, formatInteger, formatPercent } from '../../lib/format';

interface ErrorData {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  component: string;
  severity: string;
  status: string;
  occurrences: number;
}

const SEVERITY_MAP: Record<string, string> = {
  fatal: 'Critical',
  error: 'High',
  warning: 'Medium',
  info: 'Low',
  debug: 'Low',
};

function mapRow(r: logsApi.ErrorLogRow): ErrorData {
  return {
    id: r.id,
    timestamp: r.occurred_at ? new Date(r.occurred_at).toLocaleString() : '',
    type: r.code ?? r.source ?? 'Error',
    message: r.message,
    component: r.source,
    severity: SEVERITY_MAP[r.level] ?? r.level,
    status: r.resolved_at ? 'Resolved' : 'Active',
    occurrences: 1,
  };
}

const columns = [
  { header: 'Timestamp', accessor: 'timestamp' as const },
  { header: 'Type', accessor: 'type' as const },
  { header: 'Message', accessor: 'message' as const },
  { header: 'Component', accessor: 'component' as const },
  { header: 'Severity', accessor: 'severity' as const },
  { header: 'Status', accessor: 'status' as const },
  { header: 'Occurrences', accessor: 'occurrences' as const },
];

const tabs = [
  { id: 'all', label: 'All Errors' },
  { id: 'active', label: 'Active' },
  { id: 'resolved', label: 'Resolved' },
  { id: 'critical', label: 'Critical' },
];

const MetricCard = ({
  icon: Icon,
  title,
  value,
  trend,
  status,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  trend?: string;
  status: 'success' | 'warning' | 'error';
}) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div
          className={`p-2 rounded-lg ${
            status === 'success'
              ? 'bg-green-50'
              : status === 'warning'
                ? 'bg-yellow-50'
                : 'bg-red-50'
          }`}
        >
          <Icon
            className={`h-6 w-6 ${
              status === 'success'
                ? 'text-green-600'
                : status === 'warning'
                  ? 'text-yellow-600'
                  : 'text-red-600'
            }`}
          />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <p className="text-xl font-semibold mt-1">{value}</p>
          {trend && (
            <p
              className={`text-sm ${
                status === 'success'
                  ? 'text-green-600'
                  : status === 'warning'
                    ? 'text-yellow-600'
                    : 'text-red-600'
              }`}
            >
              {trend}
            </p>
          )}
        </div>
      </div>
    </div>
  </div>
);

const ErrorDistribution: React.FC<{ rows: ErrorData[] }> = ({ rows }) => {
  const groups = useMemo(() => {
    const byType = new Map<string, number>();
    for (const r of rows) {
      byType.set(r.type, (byType.get(r.type) ?? 0) + 1);
    }
    const total = rows.length || 1;
    return Array.from(byType.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({
        type,
        count,
        percentage: `${Math.round((count * 100) / total)}%`,
      }));
  }, [rows]);

  return (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Error Distribution</h2>
      <div className="space-y-4">
        {groups.length === 0 && (
          <div className="text-sm text-gray-500">No errors in selected window.</div>
        )}
        {groups.map((error) => (
          <div key={error.type} className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              <span className="text-sm font-medium text-gray-900">
                {error.type} ({error.count})
              </span>
            </div>
            <span className="text-sm text-gray-500">{error.percentage}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export function ErrorTracking() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('all');
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [selectedType, setSelectedType] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState('');
  const [tick, setTick] = useState(0);

  const [rows, setRows] = useState<ErrorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    const levelMap: Record<string, 'fatal' | 'error' | 'warning' | 'info' | 'debug'> = {
      Critical: 'fatal',
      High: 'error',
      Medium: 'warning',
      Low: 'info',
    };
    logsApi
      .listErrorLogs({
        from: toIso(startDate),
        to: toIso(endDate),
        source: selectedType || undefined,
        level: selectedSeverity ? levelMap[selectedSeverity] : undefined,
        resolved:
          activeTab === 'resolved' ? true : activeTab === 'active' ? false : undefined,
        page: 1,
        limit: 200,
      })
      .then((res) => {
        if (cancelled) return;
        setRows(res.items.map(mapRow));
        setTotal(res.total);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoading(false);
        toast(`Failed to load errors: ${(err as Error)?.message ?? err}`);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, startDate, endDate, selectedType, selectedSeverity, activeTab, tick]);

  const filteredRows = useMemo(() => {
    if (activeTab === 'critical') return rows.filter((r) => r.severity === 'Critical');
    return rows;
  }, [rows, activeTab]);

  const critical = rows.filter((r) => r.severity === 'Critical').length;
  const activeCount = rows.filter((r) => r.status === 'Active').length;
  const errorRate = total > 0 ? rows.length / total : 0;

  const filters = [
    {
      label: 'Type',
      options: Array.from(new Set(rows.map((r) => r.type).filter(Boolean))),
      value: selectedType,
      onChange: setSelectedType,
    },
    {
      label: 'Severity',
      options: ['Critical', 'High', 'Medium', 'Low'],
      value: selectedSeverity,
      onChange: setSelectedSeverity,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <AlertOctagon className="h-8 w-8 text-red-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Error Tracking</h1>
        </div>
        <div className="space-x-4">
          <button
            onClick={() => {
              if (filteredRows.length === 0) {
                toast('No errors to export.', 'error');
                return;
              }
              downloadCsv(columns, filteredRows, `error-tracking-${todayStamp()}`);
              toast(`Exported ${filteredRows.length} errors.`);
            }}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Report
          </button>
          <button
            onClick={() => setTick((t) => t + 1)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-red-600 hover:bg-red-700"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh Status
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          icon={AlertTriangle}
          title="Total Errors"
          value={loading ? '—' : formatInteger(total)}
          status="error"
        />
        <MetricCard
          icon={XCircle}
          title="Critical Issues"
          value={loading ? '—' : formatInteger(critical)}
          status="error"
        />
        <MetricCard
          icon={BarChart2}
          title="Loaded / Total"
          value={loading ? '—' : formatPercent(errorRate)}
          status="warning"
        />
        <MetricCard
          icon={Clock}
          title="Active Errors"
          value={loading ? '—' : formatInteger(activeCount)}
          status={activeCount === 0 ? 'success' : 'warning'}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Error Trend</h2>
            <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center text-gray-500">
              {loading
                ? 'Loading…'
                : `${formatInteger(total)} errors logged in selected window`}
            </div>
          </div>
        </div>
        <div className="lg:col-span-1">
          <ErrorDistribution rows={rows} />
        </div>
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
      />

      <div className="bg-white rounded-lg shadow">
        <div className="p-6">
          {loading && rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">Loading…</div>
          ) : (
            <DataTable
              columns={[
                ...columns.slice(0, 6),
                {
                  ...columns[6],
                  render: (v: number, row: ErrorData) =>
                    row.status === 'Active' ? (
                      <button
                        onClick={async () => {
                          try {
                            await monitoringApi.resolveError(row.id);
                            toast('Error marked as resolved.');
                            setTick((t) => t + 1);
                          } catch (err) {
                            toast(
                              `Failed to resolve: ${(err as Error)?.message ?? err}`
                            );
                          }
                        }}
                        className="text-xs text-blue-600 hover:underline"
                      >
                        Mark resolved
                      </button>
                    ) : (
                      v
                    ),
                },
              ]}
              data={filteredRows}
            />
          )}
        </div>
      </div>

      {critical > 0 && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4">
          <div className="flex">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">
                Active Critical Issues
              </h3>
              <div className="mt-2 text-sm text-red-700">
                <p>
                  There {critical === 1 ? 'is' : 'are'} {critical} critical{' '}
                  {critical === 1 ? 'issue' : 'issues'} in the selected window.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
