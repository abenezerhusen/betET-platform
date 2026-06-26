import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import {
  UserCheck,
  Clock,
  Activity,
  AlertTriangle,
  FileDown,
  Search,
  Users,
  MousePointer,
  RefreshCw,
} from 'lucide-react';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import * as logsApi from '../../lib/api/logs';
import { useAuthStore } from '../../store/auth';
import { formatInteger, toIso } from '../../lib/format';

interface ActivityLogData {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  resource: string;
  ipAddress: string;
  device: string;
  status: string;
  details: string;
}

function mapRow(r: logsApi.LogRow): ActivityLogData {
  const ts = r.created_at ?? r.occurred_at;
  return {
    id: r.id,
    timestamp: ts ? new Date(ts).toLocaleString() : '',
    user: r.actor_id ?? r.actor_type ?? '—',
    action: r.action,
    resource: r.resource + (r.resource_id ? ` (${r.resource_id.slice(0, 8)}…)` : ''),
    ipAddress: r.ip ?? '—',
    device: r.user_agent ? String(r.user_agent).slice(0, 80) : '—',
    status: r.status,
    details: JSON.stringify(r.payload ?? {}).slice(0, 160),
  };
}

// Section 10 — User, Action, IP Address, Device, Timestamp.
const columns = [
  { header: 'Timestamp', accessor: 'timestamp' as const },
  { header: 'User', accessor: 'user' as const },
  { header: 'Action', accessor: 'action' as const },
  { header: 'Resource', accessor: 'resource' as const },
  { header: 'IP Address', accessor: 'ipAddress' as const },
  { header: 'Device', accessor: 'device' as const },
  { header: 'Status', accessor: 'status' as const },
  { header: 'Details', accessor: 'details' as const },
];

const tabs = [
  { id: 'all', label: 'All Activity' },
  { id: 'logins', label: 'Login Activity' },
  { id: 'changes', label: 'Changes' },
  { id: 'security', label: 'Security Events' },
];

const MetricCard = ({
  icon: Icon,
  title,
  value,
  trend,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  trend?: string;
}) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className="p-2 bg-indigo-50 rounded-lg">
          <Icon className="h-6 w-6 text-indigo-600" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <p className="text-xl font-semibold mt-1">{value}</p>
          {trend && <p className="text-sm text-indigo-600">{trend}</p>}
        </div>
      </div>
    </div>
  </div>
);

export function UserActivityLogs() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('all');
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedAction, setSelectedAction] = useState('');
  const [tick, setTick] = useState(0);

  const [rows, setRows] = useState<ActivityLogData[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    logsApi
      .listActivityLogs({
        from: toIso(startDate),
        to: toIso(endDate),
        actor_id: selectedUser.trim() || undefined,
        action_prefix: selectedAction.trim() || undefined,
        page: 1,
        limit: 200,
      })
      .then((res) => {
        if (cancelled) return;
        const items = res.items ?? [];
        setRows(items.map(mapRow));
        setTotal(res.total ?? items.length);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoading(false);
        toast(`Failed to load activity logs: ${err.message ?? err}`, 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, startDate, endDate, selectedUser, selectedAction, tick]);

  const filteredRows = useMemo(() => {
    const q = activeTab;
    if (q === 'logins') return rows.filter((r) => /login|auth|session/i.test(r.action));
    if (q === 'changes') return rows.filter((r) => /update|create|delete|patch|put/i.test(r.action));
    if (q === 'security') return rows.filter((r) => /fail|denied|lock|password|token/i.test(r.action + r.details));
    return rows;
  }, [rows, activeTab]);

  const failed = rows.filter((r) => /fail/i.test(r.status)).length;

  const filters = [
    {
      label: 'Actor ID',
      type: 'text' as const,
      options: [] as string[],
      value: selectedUser,
      onChange: setSelectedUser,
    },
    {
      label: 'Action contains',
      type: 'text' as const,
      options: [] as string[],
      value: selectedAction,
      onChange: setSelectedAction,
    },
  ];

  const RecentActivity = () => (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Recent (loaded window)</h2>
      <div className="space-y-4">
        {rows.slice(0, 6).map((activity) => (
          <div key={activity.id} className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <UserCheck className="h-5 w-5 text-indigo-500" />
              <span className="text-sm font-medium text-gray-900">
                {activity.user} — {activity.action}
              </span>
            </div>
            <span className="text-sm text-gray-500">{activity.timestamp}</span>
          </div>
        ))}
        {!loading && rows.length === 0 && (
          <div className="text-sm text-gray-500">No audit rows in this range.</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Activity className="h-8 w-8 text-indigo-600" />
          <h1 className="text-2xl font-semibold text-gray-900">User Activity Logs</h1>
        </div>
        <div className="space-x-4">
          <button
            type="button"
            onClick={() => {
              if (filteredRows.length === 0) {
                toast('Nothing to export.', 'info');
                return;
              }
              downloadCsv(columns, filteredRows, `user-activity-logs-${todayStamp()}`);
              toast(`Exported ${filteredRows.length} rows.`);
            }}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Logs
          </button>
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => toast('Use filters and date range to narrow results.', 'info')}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <Search className="h-4 w-4 mr-2" />
            Help
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard icon={Users} title="Total (reported)" value={loading ? '—' : formatInteger(total)} trend="" />
        <MetricCard
          icon={MousePointer}
          title="Loaded rows"
          value={loading ? '—' : formatInteger(rows.length)}
          trend=""
        />
        <MetricCard icon={Clock} title="Window" value={`${startDate.toLocaleDateString()} →`} trend={endDate.toLocaleDateString()} />
        <MetricCard icon={AlertTriangle} title="Failed status" value={loading ? '—' : formatInteger(failed)} trend="" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Activity overview</h2>
            <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
              <span className="text-gray-500 text-sm px-4 text-center">
                {loading ? 'Loading audit trail…' : `${formatInteger(filteredRows.length)} events after tab filter`}
              </span>
            </div>
          </div>
        </div>
        <div className="lg:col-span-1">
          <RecentActivity />
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
          setSelectedUser('');
          setSelectedAction('');
          setStartDate(() => {
            const d = new Date();
            d.setDate(d.getDate() - 7);
            return d;
          });
          setEndDate(new Date());
        }}
      />

      <div className="bg-white rounded-lg shadow">
        <div className="p-6">
          {loading && rows.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-500">Loading…</div>
          ) : (
            <DataTable columns={columns} data={filteredRows} />
          )}
        </div>
      </div>
    </div>
  );
}
