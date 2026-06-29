import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { PenTool as Tool, Database, Activity, AlertCircle, HardDrive, Gauge, FileDown, RefreshCw, Power, Save } from 'lucide-react';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import * as opsApi from '../../lib/api/ops';
import * as configurationsApi from '../../lib/api/configurations';
import { useAuthStore } from '../../store/auth';

interface SystemLogData {
  id: string;
  timestamp: string;
  type: string;
  component: string;
  message: string;
  severity: string;
  status: string;
}

const mapLog = (e: opsApi.MaintenanceLogRow): SystemLogData => ({
  id: e.id,
  timestamp: e.timestamp ? new Date(e.timestamp).toLocaleString() : '—',
  type: e.type,
  component: 'system',
  message: e.message,
  severity: e.severity,
  status: e.severity === 'Critical' ? 'Active' : 'Resolved',
});

const columns = [
  { header: 'Timestamp', accessor: 'timestamp' as const },
  { header: 'Type', accessor: 'type' as const },
  { header: 'Component', accessor: 'component' as const },
  { header: 'Message', accessor: 'message' as const },
  { header: 'Severity', accessor: 'severity' as const },
  { header: 'Status', accessor: 'status' as const },
];

const tabs = [
  { id: 'site', label: 'Site Maintenance' },
  { id: 'system', label: 'System Status' },
  { id: 'backups', label: 'Backups' },
  { id: 'logs', label: 'System Logs' },
  { id: 'performance', label: 'Performance' },
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
          status === 'success' ? 'bg-green-50' : 
          status === 'warning' ? 'bg-yellow-50' : 'bg-red-50'
        }`}>
          <Icon className={`h-6 w-6 ${
            status === 'success' ? 'text-green-600' : 
            status === 'warning' ? 'text-yellow-600' : 'text-red-600'
          }`} />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <p className="text-xl font-semibold mt-1">{value}</p>
          {trend && (
            <p className={`text-sm ${
              status === 'success' ? 'text-green-600' : 
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

export function MaintenanceTools() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('site');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedType, setSelectedType] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState('');
  const [rows, setRows] = useState<SystemLogData[]>([]);
  const [status, setStatus] = useState<opsApi.MaintenanceStatusResponse | null>(null);
  const [backups, setBackups] = useState<opsApi.BackupFileRow[]>([]);
  const [cacheStats, setCacheStats] = useState<{ hit_rate_pct: number; size_mb: number; key_count: number } | null>(null);
  const [dbStats, setDbStats] = useState<{ table_counts: Record<string, number>; db_size_mb: number; slow_queries: unknown[]; index_health: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [siteEnabled, setSiteEnabled] = useState(false);
  const [siteMessage, setSiteMessage] = useState(
    'System is on maintenance. Please wait until we finished.'
  );
  const [siteSaving, setSiteSaving] = useState(false);
  const [siteLoading, setSiteLoading] = useState(true);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setSiteLoading(true);
    configurationsApi
      .getMaintenanceConfig()
      .then((cfg) => {
        if (cancelled) return;
        setSiteEnabled(Boolean(cfg.enabled));
        if (typeof cfg.message === 'string' && cfg.message.trim()) {
          setSiteMessage(cfg.message.trim());
        }
      })
      .catch((err: Error) =>
        toast(`Failed to load site maintenance config: ${err.message ?? err}`, 'error')
      )
      .finally(() => {
        if (!cancelled) setSiteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth]);

  const saveSiteMaintenance = async () => {
    if (siteSaving) return;
    setSiteSaving(true);
    try {
      await configurationsApi.updateMaintenanceConfig({
        enabled: siteEnabled,
        message: siteMessage.trim() || 'System is on maintenance. Please wait until we finished.',
      });
      toast(
        siteEnabled
          ? 'Site maintenance enabled — user panel and cashier panel will show the maintenance message.'
          : 'Site maintenance disabled — system is running normally.'
      );
    } catch (err) {
      toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSiteSaving(false);
    }
  };

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      opsApi.listMaintenanceLogs().catch(() => []),
      opsApi.getMaintenanceStatus().catch(() => null),
      opsApi.listMaintenanceBackups().catch(() => []),
      opsApi.getMaintenanceCacheStats().catch(() => null),
      opsApi.getMaintenanceDbStats().catch(() => null),
    ])
      .then(([logsRes, statusRes, backupsRes, cacheRes, dbRes]) => {
        if (cancelled) return;
        setRows((logsRes ?? []).map(mapLog));
        setStatus(statusRes);
        setBackups(backupsRes ?? []);
        setCacheStats(cacheRes);
        setDbStats(dbRes);
      })
      .catch((err: Error) => toast(`Failed to load maintenance data: ${err.message ?? err}`, 'error'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth]);

  // Spec: System Status block polls every 30s. We keep the logs/backups/
  // cache/db stats one-shot since those change much less frequently.
  useEffect(() => {
    if (!isAuth) return;
    const interval = setInterval(() => {
      void opsApi
        .getMaintenanceStatus()
        .then((res) => setStatus(res))
        .catch(() => {
          /* silent — the user-visible status will just stay stale */
        });
    }, 30000);
    return () => clearInterval(interval);
  }, [isAuth]);

  const filters = [
    {
      label: 'Type',
      options: ['System', 'Performance', 'Security'],
      value: selectedType,
      onChange: setSelectedType,
    },
    {
      label: 'Severity',
      options: ['Info', 'Warning', 'Critical'],
      value: selectedSeverity,
      onChange: setSelectedSeverity,
    },
  ];

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!selectedType || r.type === selectedType) &&
          (!selectedSeverity || r.severity === selectedSeverity)
      ),
    [rows, selectedType, selectedSeverity]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div className="flex items-center space-x-3">
          <Tool className="h-8 w-8 text-purple-600 shrink-0" />
          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900">Maintenance Tools</h1>
        </div>
        <div className="flex flex-wrap gap-2 sm:gap-4">
          <button
            onClick={() => {
              downloadCsv(columns, filteredRows, `system-logs-${todayStamp()}`);
              toast(`Exported ${filteredRows.length} system logs.`);
            }}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Logs
          </button>
          <button
            onClick={() => toast('Running system diagnostics…')}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Run Diagnostics
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          icon={Database}
          title="Database Status"
          value={loading ? '—' : (status?.services.find((s) => s.name === 'Database')?.status ?? 'unknown')}
          trend={dbStats ? `DB size: ${dbStats.db_size_mb} MB` : 'No DB stats'}
          status="success"
        />
        <MetricCard
          icon={Activity}
          title="System Load"
          value={loading ? '—' : `${filteredRows.filter((r) => r.status === 'Active').length} active logs`}
          trend="from monitoring/errors"
          status={filteredRows.some((r) => r.status === 'Active') ? 'warning' : 'success'}
        />
        <MetricCard
          icon={HardDrive}
          title="Storage Usage"
          value={loading ? '—' : `${backups.length} backups`}
          trend={cacheStats ? `Cache: ${cacheStats.size_mb} MB` : 'No cache stats'}
          status="success"
        />
        <MetricCard
          icon={Gauge}
          title="API Response Time"
          value={loading ? '—' : `${status?.services.find((s) => s.name === 'Backend API')?.latency_ms ?? 0} ms`}
          trend="maintenance status API"
          status="success"
        />
      </div>

      <div className="bg-white p-6 rounded-lg shadow-sm">
        <h2 className="text-lg font-medium text-gray-900 mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <button
            onClick={async () => {
              const res = await opsApi.triggerMaintenanceBackup();
              toast(res.message || 'Backup triggered.');
              const latest = await opsApi.listMaintenanceBackups().catch(() => backups);
              setBackups(latest);
            }}
            className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <Database className="h-5 w-5 mr-2 text-purple-600" />
            Create Backup
          </button>
          <button
            onClick={async () => {
              const res = await opsApi.flushMaintenanceCache();
              toast(res.message || 'Cache flush requested.');
              const latest = await opsApi.getMaintenanceCacheStats().catch(() => cacheStats);
              setCacheStats(latest);
            }}
            className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <HardDrive className="h-5 w-5 mr-2 text-purple-600" />
            Clear Cache
          </button>
          <button
            onClick={async () => {
              const [s, db] = await Promise.all([
                opsApi.getMaintenanceStatus().catch(() => status),
                opsApi.getMaintenanceDbStats().catch(() => dbStats),
              ]);
              setStatus(s);
              setDbStats(db);
              toast('Diagnostics refreshed.');
            }}
            className="flex items-center justify-center px-4 py-3 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <Activity className="h-5 w-5 mr-2 text-purple-600" />
            Test Connections
          </button>
        </div>
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === 'site' && (
        <div className="bg-white rounded-lg shadow-sm p-6 space-y-6">
          <div className="flex items-start gap-3">
            <Power className="h-6 w-6 text-purple-600 mt-0.5 shrink-0" />
            <div>
              <h2 className="text-lg font-medium text-gray-900">User Panel Maintenance</h2>
              <p className="text-sm text-gray-500 mt-1">
                When enabled, the user panel and cashier panel show a maintenance message and block
                new bets, games, and cashier operations. Disable to resume normal operation.
              </p>
            </div>
          </div>

          {siteLoading ? (
            <p className="text-sm text-gray-500">Loading maintenance settings…</p>
          ) : (
            <>
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={siteEnabled}
                  onChange={(e) => setSiteEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                <span className="text-sm font-medium text-gray-900">
                  Enable site maintenance mode
                </span>
              </label>

              <div>
                <label
                  htmlFor="maintenance-message"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Message shown to users
                </label>
                <textarea
                  id="maintenance-message"
                  rows={3}
                  value={siteMessage}
                  onChange={(e) => setSiteMessage(e.target.value)}
                  className="w-full border border-gray-300 rounded-md shadow-sm text-sm px-3 py-2 focus:ring-purple-500 focus:border-purple-500"
                  placeholder="System is on maintenance. Please wait until we finished."
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  disabled={siteSaving}
                  onClick={() => void saveSiteMaintenance()}
                  className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {siteSaving ? 'Saving…' : 'Save Maintenance Settings'}
                </button>
                <span
                  className={`text-sm font-medium ${
                    siteEnabled ? 'text-amber-600' : 'text-green-600'
                  }`}
                >
                  {siteEnabled ? 'Maintenance is ON' : 'System is running normally'}
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {activeTab === 'logs' && (
        <>
          <FilterBar
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            filters={filters}
            onClear={() => {
              setSelectedType('');
              setSelectedSeverity('');
              setStartDate(new Date());
              setEndDate(new Date());
            }}
          />

          <div className="bg-white rounded-lg shadow">
            <div className="p-6">
              <DataTable columns={columns} data={filteredRows} />
            </div>
          </div>
        </>
      )}

      {activeTab !== 'site' && activeTab !== 'logs' && (
        <div className="bg-white rounded-lg shadow-sm p-6 text-sm text-gray-600">
          {activeTab === 'system' && (
            <p>
              Database: {status?.services.find((s) => s.name === 'Database')?.status ?? 'unknown'} ·
              API latency: {status?.services.find((s) => s.name === 'Backend API')?.latency_ms ?? 0}{' '}
              ms
            </p>
          )}
          {activeTab === 'backups' && <p>{backups.length} backup file(s) on record.</p>}
          {activeTab === 'performance' && (
            <p>
              Cache hit rate: {cacheStats?.hit_rate_pct ?? 0}% · DB size:{' '}
              {dbStats?.db_size_mb ?? 0} MB
            </p>
          )}
        </div>
      )}

      <div className="bg-purple-50 border-l-4 border-purple-400 p-4">
        <div className="flex">
          <AlertCircle className="h-5 w-5 text-purple-400" />
          <div className="ml-3">
            <h3 className="text-sm font-medium text-purple-800">Maintenance Schedule</h3>
            <div className="mt-2 text-sm text-purple-700">
              <p>Backups available: {backups.length}</p>
              <p className="mt-1">DB health: {dbStats?.index_health ?? 'unknown'}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
