import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { toast } from '../../lib/toast';
import { 
  Network, 
  Zap, 
  Clock, 
  AlertTriangle, 
  FileCode, 
  Lock,
  RefreshCw,
  FileDown,
  CheckCircle,
  XCircle
} from 'lucide-react';
import * as opsApi from '../../lib/api/ops';
import { useAuthStore } from '../../store/auth';

interface ApiEndpointData {
  id: string;
  endpoint: string;
  method: string;
  version: string;
  rateLimit: string;
  avgResponse: string;
  status: string;
  lastTested: string;
  callsToday: number;
  errorRatePct: number;
}

const columns = [
  { header: 'Endpoint', accessor: 'endpoint' as const },
  { header: 'Method', accessor: 'method' as const },
  { header: 'Version', accessor: 'version' as const },
  { header: 'Rate Limit', accessor: 'rateLimit' as const },
  { header: 'Avg Response', accessor: 'avgResponse' as const },
  { header: 'Status', accessor: 'status' as const },
  { header: 'Last Tested', accessor: 'lastTested' as const },
];

const tabs = [
  { id: 'endpoints', label: 'Endpoints' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'security', label: 'Security' },
  { id: 'monitoring', label: 'Monitoring' },
];

const MetricCard = ({ 
  icon: Icon, 
  title, 
  value, 
  trend, 
  status 
}: { 
  icon: any, 
  title: string, 
  value: string, 
  trend?: string,
  status: 'success' | 'warning' | 'error' 
}) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className={`p-2 rounded-lg ${
          status === 'success' ? 'bg-blue-50' : 
          status === 'warning' ? 'bg-yellow-50' : 'bg-red-50'
        }`}>
          <Icon className={`h-6 w-6 ${
            status === 'success' ? 'text-blue-600' : 
            status === 'warning' ? 'text-yellow-600' : 'text-red-600'
          }`} />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <p className="text-xl font-semibold mt-1">{value}</p>
          {trend && (
            <p className={`text-sm ${
              status === 'success' ? 'text-blue-600' : 
              status === 'warning' ? 'text-yellow-600' : 'text-red-600'
            }`}>
              {trend}
            </p>
          )}
        </div>
      </div>
    </div>
  </div>
);

const EndpointHealth = ({ data }: { data: ApiEndpointData[] }) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <h2 className="text-lg font-medium text-gray-900 mb-4">Endpoint Health</h2>
    <div className="space-y-4">
      {data.slice(0, 5).map((endpoint) => (
        <div key={endpoint.id} className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {endpoint.status === 'Active' ? (
              <CheckCircle className="h-5 w-5 text-green-500" />
            ) : (
              <XCircle className="h-5 w-5 text-yellow-500" />
            )}
            <span className="text-sm font-medium text-gray-900">{endpoint.endpoint}</span>
          </div>
          <span className={`text-sm ${
            parseInt(endpoint.avgResponse, 10) < 300 ? 'text-green-600' : 'text-yellow-600'
          }`}>
            {endpoint.avgResponse}
          </span>
        </div>
      ))}
      {data.length === 0 && <div className="text-sm text-gray-500">No endpoint metrics available.</div>}
    </div>
  </div>
);

export function ApiManagement() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('endpoints');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedVersion, setSelectedVersion] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [rows, setRows] = useState<ApiEndpointData[]>([]);
  const [webhooksCount, setWebhooksCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const [endpointRows, webhookRows] = await Promise.all([
      opsApi.listApiManagementEndpoints(),
      opsApi.listApiManagementWebhooks().catch(() => []),
    ]);
    setRows(
      (endpointRows ?? []).map((m, idx) => ({
        id: `${m.method}-${m.endpoint}-${idx}`,
        endpoint: m.endpoint,
        method: m.method,
        version: m.version,
        rateLimit: m.rate_limit,
        avgResponse: `${m.avg_response_ms}ms`,
        status: m.status,
        lastTested: m.last_tested ? new Date(m.last_tested).toLocaleString() : '—',
        callsToday: m.calls_today,
        errorRatePct: Number(m.error_rate_pct ?? 0),
      }))
    );
    setWebhooksCount(webhookRows.length);
  }, []);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    refresh()
      .catch((err: Error) => toast(`Failed to load API metrics: ${err.message ?? err}`, 'error'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, refresh]);

  // Spec: API Management refreshes every 60s.
  useEffect(() => {
    if (!isAuth) return;
    const interval = setInterval(() => {
      void refresh().catch(() => undefined);
    }, 60000);
    return () => clearInterval(interval);
  }, [isAuth, refresh]);

  const filters = [
    {
      label: 'Version',
      options: ['v1', 'v2', 'v3'],
      value: selectedVersion,
      onChange: setSelectedVersion,
    },
    {
      label: 'Status',
      options: ['Active', 'Warning', 'Degraded'],
      value: selectedStatus,
      onChange: setSelectedStatus,
    },
  ];

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (row) =>
          (!selectedVersion || row.version === selectedVersion) &&
          (!selectedStatus || row.status === selectedStatus)
      ),
    [rows, selectedVersion, selectedStatus]
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Network className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">API Management</h1>
        </div>
        <div className="space-x-4">
          <button
            onClick={() => toast('API metrics exported.')}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Metrics
          </button>
          <button
            onClick={() => {
              Promise.all(
                filteredRows.slice(0, 10).map((row) =>
                  opsApi.testApiManagementEndpoint({
                    endpoint: row.endpoint,
                    method: (row.method as 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') || 'GET',
                  })
                )
              )
                .then(() => toast('Endpoint tests completed.'))
                .catch((err: Error) => toast(`Endpoint tests failed: ${err.message ?? err}`, 'error'));
            }}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Test All Endpoints
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          icon={Zap}
          title="Total Requests"
          value={loading ? '—' : String(filteredRows.reduce((acc, row) => acc + row.callsToday, 0))}
          trend="calls today"
          status="success"
        />
        <MetricCard
          icon={Clock}
          title="Avg Response Time"
          value={
            loading
              ? '—'
              : `${Math.round(
                  filteredRows.reduce((acc, row) => acc + Number.parseInt(row.avgResponse, 10), 0) /
                    Math.max(filteredRows.length, 1)
                )}ms`
          }
          trend="from performance metrics"
          status="success"
        />
        <MetricCard
          icon={AlertTriangle}
          title="Error Rate"
          value={
            loading
              ? '—'
              : `${(
                  filteredRows.reduce((acc, row) => acc + row.errorRatePct, 0) /
                  Math.max(filteredRows.length, 1)
                ).toFixed(2)}%`
          }
          trend="avg error rate"
          status={filteredRows.some((r) => r.status !== 'Active') ? 'warning' : 'success'}
        />
        <MetricCard
          icon={Lock}
          title="Webhooks"
          value={loading ? '—' : `${webhooksCount} registered`}
          trend="delivery endpoints"
          status="success"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h2 className="text-lg font-medium text-gray-900 mb-4">API Traffic</h2>
            <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
              <span className="text-gray-500">
                {loading ? 'Loading endpoint metrics…' : `${filteredRows.length} endpoint rows in selected filters`}
              </span>
            </div>
          </div>
        </div>
        <div className="lg:col-span-1">
          <EndpointHealth data={filteredRows} />
        </div>
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
        onClear={() => {
          setSelectedVersion('');
          setSelectedStatus('');
          setStartDate(new Date());
          setEndDate(new Date());
        }}
      />

      <div className="bg-white rounded-lg shadow">
        <div className="p-6">
          <DataTable columns={columns} data={filteredRows} />
          <div className="mt-3 text-xs text-gray-500">
            Data source: `/api/admin/api-management/endpoints` and `/api/admin/api-management/webhooks`.
          </div>
        </div>
      </div>

      <div className="bg-blue-50 border-l-4 border-blue-400 p-4">
        <div className="flex">
          <FileCode className="h-5 w-5 text-blue-400" />
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">API Documentation</h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>Latest API documentation is available at /api/docs</p>
              <p className="mt-1">Last updated: March 20, 2024</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
