import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import {
  BarChart2,
  Cpu,
  Database,
  Network,
  FileDown,
  RefreshCw,
  Clock,
  Activity,
} from 'lucide-react';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
// Section 10 spec calls /api/admin/analytics/performance. The endpoint
// returns aggregate stats (peak hours, slowest endpoints, p95 etc.) AND
// the raw items so the existing row-per-period table keeps working.
import * as analyticsApi from '../../lib/api/analytics';
import type { PerformanceMetricRow } from '../../lib/api/monitoring';
import { useAuthStore } from '../../store/auth';
import { formatInteger, toIso } from '../../lib/format';

interface PerformanceData {
  id: string;
  timestamp: string;
  metric: string;
  value: number;
  threshold: number;
  status: string;
  trend: string;
}

function mapRow(r: PerformanceMetricRow): PerformanceData {
  const value = r.p95_ms ?? r.avg_ms ?? r.request_count;
  const threshold = r.p99_ms ?? (typeof value === 'number' ? Math.round(value * 1.25) : 0);
  const errRatio = r.request_count > 0 ? r.error_count / r.request_count : 0;
  const status = errRatio > 0.1 ? 'Critical' : errRatio > 0 ? 'Warning' : 'Normal';
  return {
    id: r.id,
    timestamp: new Date(r.period_start).toLocaleString(),
    metric: `${r.kind}:${r.name}`,
    value: typeof value === 'number' ? value : 0,
    threshold: typeof threshold === 'number' ? threshold : 0,
    status,
    trend: r.method ? `${r.method}` : '—',
  };
}

const columns = [
  { header: 'Timestamp', accessor: 'timestamp' as const },
  { header: 'Metric', accessor: 'metric' as const },
  { header: 'Value', accessor: 'value' as const },
  { header: 'Threshold', accessor: 'threshold' as const },
  { header: 'Status', accessor: 'status' as const },
  { header: 'Trend', accessor: 'trend' as const },
];

const tabs = [
  { id: 'overview', label: 'Overview' },
  { id: 'resources', label: 'Resources' },
  { id: 'network', label: 'Network' },
  { id: 'database', label: 'Database' },
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
            status === 'success' ? 'bg-green-50' : status === 'warning' ? 'bg-yellow-50' : 'bg-red-50'
          }`}
        >
          <Icon
            className={`h-6 w-6 ${
              status === 'success' ? 'text-green-600' : status === 'warning' ? 'text-yellow-600' : 'text-red-600'
            }`}
          />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <p className="text-xl font-semibold mt-1">{value}</p>
          {trend && (
            <p
              className={`text-sm ${
                status === 'success' ? 'text-green-600' : status === 'warning' ? 'text-yellow-600' : 'text-red-600'
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

const ResourceUtilization: React.FC<{ rows: PerformanceData[] }> = ({ rows }) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <h2 className="text-lg font-medium text-gray-900 mb-4">Sample metrics</h2>
    <div className="space-y-4">
      {rows.slice(0, 5).map((resource) => (
        <div key={resource.id} className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Cpu
              className={`h-5 w-5 ${
                resource.status === 'Normal' ? 'text-green-500' : 'text-yellow-500'
              }`}
            />
            <span className="text-sm font-medium text-gray-900">{resource.metric}</span>
          </div>
          <span
            className={`text-sm ${
              resource.status === 'Normal' ? 'text-green-600' : 'text-yellow-600'
            }`}
          >
            {resource.value}
          </span>
        </div>
      ))}
      {rows.length === 0 && <div className="text-sm text-gray-500">No metrics in range.</div>}
    </div>
  </div>
);

export function PerformanceAnalytics() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('overview');
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [selectedMetric, setSelectedMetric] = useState('');
  const [tick, setTick] = useState(0);

  const [rows, setRows] = useState<PerformanceData[]>([]);
  const [overview, setOverview] = useState<analyticsApi.PerformanceOverview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    analyticsApi
      .getPerformanceOverview({
        from: toIso(startDate),
        to: toIso(endDate),
        name: selectedMetric.trim() || undefined,
        top: 10,
      })
      .then((res) => {
        if (cancelled) return;
        setOverview(res);
        setRows((res.items ?? []).map(mapRow));
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoading(false);
        toast(`Failed to load metrics: ${err.message ?? err}`, 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, startDate, endDate, selectedMetric, tick]);

  const filteredRows = useMemo(() => {
    if (activeTab === 'resources') return rows.filter((r) => r.metric.startsWith('route:'));
    if (activeTab === 'network') return rows.filter((r) => r.metric.startsWith('webhook:'));
    if (activeTab === 'database') return rows.filter((r) => r.metric.startsWith('job:'));
    return rows;
  }, [rows, activeTab]);

  const warn = filteredRows.filter((r) => r.status !== 'Normal').length;

  const filters = [
    {
      label: 'Metric name contains',
      type: 'text' as const,
      options: [] as string[],
      value: selectedMetric,
      onChange: setSelectedMetric,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <BarChart2 className="h-8 w-8 text-green-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Performance Analytics</h1>
        </div>
        <div className="space-x-4">
          <button
            type="button"
            onClick={() => {
              if (filteredRows.length === 0) {
                toast('Nothing to export.', 'info');
                return;
              }
              downloadCsv(columns, filteredRows, `performance-metrics-${todayStamp()}`);
              toast(`Exported ${filteredRows.length} metrics.`);
            }}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Metrics
          </button>
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          icon={Cpu}
          title="Avg p95 (ms)"
          value={loading || !overview?.summary ? '—' : formatInteger(overview.summary.p95_ms ?? 0)}
          trend="API response — 95th percentile"
          status="success"
        />
        <MetricCard
          icon={Database}
          title="DB query p95 (ms)"
          value={
            loading || !overview?.database_query_time
              ? '—'
              : formatInteger(overview.database_query_time.p95_ms ?? 0)
          }
          trend="database — 95th percentile"
          status="success"
        />
        <MetricCard
          icon={Network}
          title="Request count"
          value={loading || !overview?.summary ? '—' : formatInteger(Number(overview.summary.request_count) || 0)}
          trend={`${overview?.summary ? formatInteger(Number(overview.summary.error_count) || 0) : '0'} errors`}
          status={warn === 0 ? 'success' : 'warning'}
        />
        <MetricCard icon={Clock} title="Window end" value={endDate.toLocaleDateString()} trend="" status="success" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Slowest endpoints</h2>
            <div className="space-y-2">
              {loading && <div className="text-sm text-gray-500">Loading…</div>}
              {!loading && (overview?.slowest_endpoints?.length ?? 0) === 0 && (
                <div className="text-sm text-gray-500">No route metrics in window.</div>
              )}
              {(overview?.slowest_endpoints ?? []).map((e) => (
                <div
                  key={`${e.method ?? '*'}-${e.name}`}
                  className="flex items-center justify-between border-b border-gray-100 pb-2 last:border-0"
                >
                  <div className="text-sm">
                    <span className="font-mono text-xs text-gray-500">{e.method ?? '—'}</span>{' '}
                    <span className="font-medium text-gray-900">{e.name}</span>
                  </div>
                  <div className="text-sm text-gray-700">
                    p95 <strong>{formatInteger(e.p95_ms ?? 0)}ms</strong> ·{' '}
                    {formatInteger(Number(e.request_count) || 0)} req
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="lg:col-span-1">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Peak hours</h2>
            <div className="space-y-2">
              {loading && <div className="text-sm text-gray-500">Loading…</div>}
              {!loading && (overview?.peak_hours?.length ?? 0) === 0 && (
                <div className="text-sm text-gray-500">No data.</div>
              )}
              {(overview?.peak_hours ?? []).slice(0, 8).map((h) => (
                <div key={h.hour} className="flex items-center justify-between">
                  <span className="text-sm text-gray-900">
                    {String(h.hour).padStart(2, '0')}:00
                  </span>
                  <span className="text-sm text-gray-700">
                    {formatInteger(Number(h.request_count) || 0)} req
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-6">
            <ResourceUtilization rows={filteredRows} />
          </div>
        </div>
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
        onClear={() => {
          setSelectedMetric('');
          setStartDate(() => {
            const d = new Date();
            d.setDate(d.getDate() - 14);
            return d;
          });
          setEndDate(new Date());
        }}
      />

      <div className="bg-white rounded-lg shadow">
        <div className="p-6">
          {loading && filteredRows.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">Loading…</div>
          ) : (
            <DataTable columns={columns} data={filteredRows} />
          )}
        </div>
      </div>

      <div className="bg-green-50 border-l-4 border-green-400 p-4">
        <div className="flex">
          <Activity className="h-5 w-5 text-green-400" />
          <div className="ml-3">
            <h3 className="text-sm font-medium text-green-800">Recorded metrics</h3>
            <div className="mt-2 text-sm text-green-700">
              <p>
                Data is read from PostgreSQL <code className="text-xs">performance_metrics</code> when the backend
                records aggregates.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
