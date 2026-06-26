import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import {
  History,
  User,
  FileText,
  Shield,
  FileDown,
  Search,
  Users,
  Clock,
} from 'lucide-react';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import * as logsApi from '../../lib/api/logs';
import { useAuthStore } from '../../store/auth';
import { toIso, formatInteger } from '../../lib/format';

interface AuditData {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  resource: string;
  oldValue: string;
  newValue: string;
  ipAddress: string;
  status: string;
}

function extractValues(payload: Record<string, unknown> | null): {
  oldValue: string;
  newValue: string;
} {
  if (!payload) return { oldValue: '', newValue: '' };
  // Most admin writers store { before, after } or { old, new }.
  const before = (payload.before ?? payload.old ?? null) as unknown;
  const after = (payload.after ?? payload.new ?? null) as unknown;
  if (before || after) {
    return {
      oldValue: before == null ? '' : JSON.stringify(before).slice(0, 200),
      newValue: after == null ? '' : JSON.stringify(after).slice(0, 200),
    };
  }
  return {
    oldValue: '',
    newValue: JSON.stringify(payload).slice(0, 200),
  };
}

function mapRow(r: logsApi.LogRow): AuditData {
  const ts = r.created_at ?? r.occurred_at;
  const { oldValue, newValue } = extractValues(r.payload);
  return {
    id: r.id,
    timestamp: ts ? new Date(ts).toLocaleString() : '',
    user: r.actor_id ?? r.actor_type ?? 'system',
    action: r.action,
    resource: r.resource + (r.resource_id ? ` (${r.resource_id.slice(0, 8)}…)` : ''),
    oldValue,
    newValue,
    ipAddress: r.ip ?? '',
    status: r.status,
  };
}

// Section 10 — Admin User, Action, Affected Resource, Old Value,
// New Value, IP, Timestamp.
const columns = [
  { header: 'Timestamp', accessor: 'timestamp' as const },
  { header: 'Admin User', accessor: 'user' as const },
  { header: 'Action', accessor: 'action' as const },
  { header: 'Resource', accessor: 'resource' as const },
  { header: 'Old Value', accessor: 'oldValue' as const },
  { header: 'New Value', accessor: 'newValue' as const },
  { header: 'IP Address', accessor: 'ipAddress' as const },
  { header: 'Status', accessor: 'status' as const },
];

const tabs = [
  { id: 'all', label: 'All Activities' },
  { id: 'user', label: 'User Actions' },
  { id: 'system', label: 'System Events' },
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
        <div className="p-2 bg-blue-50 rounded-lg">
          <Icon className="h-6 w-6 text-blue-600" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <p className="text-xl font-semibold mt-1">{value}</p>
          {trend && <p className="text-sm text-blue-600">{trend}</p>}
        </div>
      </div>
    </div>
  </div>
);

const RecentActivity: React.FC<{ rows: AuditData[] }> = ({ rows }) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <h2 className="text-lg font-medium text-gray-900 mb-4">Recent Activity</h2>
    <div className="space-y-4">
      {rows.slice(0, 5).map((activity) => (
        <div key={activity.id} className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <User className="h-5 w-5 text-blue-500" />
            <span className="text-sm font-medium text-gray-900">
              {activity.user} - {activity.action} {activity.resource}
            </span>
          </div>
          <span className="text-sm text-gray-500">{activity.timestamp}</span>
        </div>
      ))}
      {rows.length === 0 && (
        <div className="text-sm text-gray-500">No recent activity.</div>
      )}
    </div>
  </div>
);

export function AuditTrail() {
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

  const [rows, setRows] = useState<AuditData[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    logsApi
      .listAuditLogs({
        from: toIso(startDate),
        to: toIso(endDate),
        actor_id: selectedUser || undefined,
        action_prefix: selectedAction || undefined,
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
        toast(`Failed to load audit logs: ${(err as Error)?.message ?? err}`);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, startDate, endDate, selectedUser, selectedAction]);

  const filteredRows = useMemo(() => {
    if (activeTab === 'all') return rows;
    if (activeTab === 'user') return rows.filter((r) => !r.user.startsWith('system'));
    if (activeTab === 'system') return rows.filter((r) => r.user.startsWith('system'));
    if (activeTab === 'security')
      return rows.filter(
        (r) =>
          r.action.toLowerCase().includes('login') ||
          r.action.toLowerCase().includes('password') ||
          r.resource === 'security'
      );
    return rows;
  }, [rows, activeTab]);

  const securityCount = rows.filter(
    (r) =>
      r.action.toLowerCase().includes('login') ||
      r.action.toLowerCase().includes('password') ||
      r.resource === 'security'
  ).length;

  const activeUsers = new Set(rows.map((r) => r.user)).size;

  const filters = [
    {
      label: 'User',
      options: Array.from(new Set(rows.map((r) => r.user).filter(Boolean))),
      value: selectedUser,
      onChange: setSelectedUser,
    },
    {
      label: 'Action',
      options: Array.from(new Set(rows.map((r) => r.action).filter(Boolean))),
      value: selectedAction,
      onChange: setSelectedAction,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <History className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Audit Trail</h1>
        </div>
        <div className="space-x-4">
          <button
            onClick={() => {
              if (filteredRows.length === 0) {
                toast('No audit entries to export.', 'error');
                return;
              }
              downloadCsv(columns, filteredRows, `audit-trail-${todayStamp()}`);
              toast(`Exported ${filteredRows.length} audit entries.`);
            }}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Logs
          </button>
          <button
            onClick={() => toast('Use the filters above for advanced filtering.')}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            <Search className="h-4 w-4 mr-2" />
            Advanced Search
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard
          icon={Users}
          title="Active Users"
          value={loading ? '—' : formatInteger(activeUsers)}
        />
        <MetricCard
          icon={FileText}
          title="Total Events"
          value={loading ? '—' : formatInteger(total)}
        />
        <MetricCard
          icon={Shield}
          title="Security Events"
          value={loading ? '—' : formatInteger(securityCount)}
        />
        <MetricCard
          icon={Clock}
          title="Window"
          value={`${Math.max(
            1,
            Math.round((endDate.getTime() - startDate.getTime()) / 86400000)
          )} days`}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h2 className="text-lg font-medium text-gray-900 mb-4">
              Activity Timeline
            </h2>
            <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center text-gray-500">
              {loading
                ? 'Loading…'
                : `${formatInteger(total)} events in selected window`}
            </div>
          </div>
        </div>
        <div className="lg:col-span-1">
          <RecentActivity rows={rows} />
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

      <div className="bg-blue-50 border-l-4 border-blue-400 p-4">
        <div className="flex">
          <Shield className="h-5 w-5 text-blue-400" />
          <div className="ml-3">
            <h3 className="text-sm font-medium text-blue-800">Audit Policy</h3>
            <div className="mt-2 text-sm text-blue-700">
              <p>
                All admin actions are recorded in the audit trail. The
                table is <strong>immutable</strong> — rows cannot be
                edited or deleted, even by super-admins.
              </p>
              <p className="mt-1">
                Filter by admin user, action, or date range above.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
