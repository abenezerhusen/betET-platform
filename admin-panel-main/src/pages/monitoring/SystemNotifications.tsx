import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import {
  Bell,
  AlertTriangle,
  CheckCircle,
  FileDown,
  Settings,
  MessageSquare,
  Users,
  RefreshCw,
} from 'lucide-react';
import { downloadCsv, todayStamp } from '../../lib/csv';
import { toast } from '../../lib/toast';
import * as monitoringApi from '../../lib/api/monitoring';
import { useAuthStore } from '../../store/auth';
import { formatInteger } from '../../lib/format';

interface NotificationData {
  id: string;
  timestamp: string;
  type: string;
  message: string;
  priority: string;
  status: string;
  recipients: string;
  readByMe: boolean;
}

function mapRow(r: monitoringApi.SystemNotificationRow): NotificationData {
  const PRIORITY: Record<string, string> = {
    critical: 'Critical',
    error: 'High',
    warning: 'Medium',
    success: 'Low',
    info: 'Low',
  };
  return {
    id: r.id,
    timestamp: r.created_at ? new Date(r.created_at).toLocaleString() : '',
    type: r.title,
    message: r.message,
    priority: PRIORITY[r.level] ?? r.level,
    status: r.status,
    recipients: r.target_user_id ? `user:${r.target_user_id.slice(0, 8)}…` : r.target_role,
    readByMe: Boolean(r.read_by_me),
  };
}

const columns = [
  { header: 'Timestamp', accessor: 'timestamp' as const },
  { header: 'Type', accessor: 'type' as const },
  { header: 'Message', accessor: 'message' as const },
  { header: 'Priority', accessor: 'priority' as const },
  { header: 'Status', accessor: 'status' as const },
  { header: 'Recipients', accessor: 'recipients' as const },
  { header: 'Read', accessor: 'readByMe' as const },
];

const tabs = [
  { id: 'all', label: 'All Notifications' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'security', label: 'Security' },
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
        <div className="p-2 bg-purple-50 rounded-lg">
          <Icon className="h-6 w-6 text-purple-600" />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <p className="text-xl font-semibold mt-1">{value}</p>
          {trend && <p className="text-sm text-purple-600">{trend}</p>}
        </div>
      </div>
    </div>
  </div>
);

export function SystemNotifications() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('all');
  const [startDate, setStartDate] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d;
  });
  const [endDate, setEndDate] = useState<Date>(new Date());
  const [selectedLevel, setSelectedLevel] = useState('');
  const [tick, setTick] = useState(0);

  const [rows, setRows] = useState<NotificationData[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    monitoringApi
      .listNotifications({
        level: selectedLevel
          ? (selectedLevel as monitoringApi.SystemNotificationRow['level'])
          : undefined,
        page: 1,
        limit: 200,
      })
      .then((res) => {
        if (cancelled) return;
        const mapped = (res.items ?? []).map(mapRow);
        setRows(mapped);
        setTotal(res.total ?? mapped.length);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setLoading(false);
        toast(`Failed to load notifications: ${err.message ?? err}`, 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth, selectedLevel, tick]);

  const filteredRows = useMemo(() => {
    const inRange = (r: NotificationData) => {
      const t = new Date(r.timestamp).getTime();
      return !Number.isNaN(t) && t >= startDate.getTime() && t <= endDate.getTime();
    };
    const base = rows.filter(inRange);
    if (activeTab === 'alerts')
      return base.filter((r) => /alert|error|critical/i.test(r.type + r.message + r.priority));
    if (activeTab === 'maintenance') return base.filter((r) => /maint/i.test(r.type + r.message));
    if (activeTab === 'security') return base.filter((r) => /security|auth|login/i.test(r.type + r.message));
    return base;
  }, [rows, activeTab, startDate, endDate]);

  const queued = filteredRows.filter((r) => r.status === 'queued').length;
  const unreadByMe = filteredRows.filter((r) => !r.readByMe).length;

  const levelFilters = [
    {
      label: 'Level',
      options: ['critical', 'error', 'warning', 'info', 'success'],
      value: selectedLevel,
      onChange: setSelectedLevel,
    },
  ];

  const ActiveNotifications = () => (
    <div className="bg-white p-6 rounded-lg shadow-sm">
      <h2 className="text-lg font-medium text-gray-900 mb-4">Latest</h2>
      <div className="space-y-4">
        {filteredRows.slice(0, 6).map((notification) => (
          <div key={notification.id} className="flex items-center justify-between gap-2">
            <div className="flex items-center space-x-2 min-w-0">
              {notification.priority === 'Critical' || notification.priority === 'High' ? (
                <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              ) : notification.priority === 'Medium' ? (
                <Bell className="h-5 w-5 text-yellow-500 shrink-0" />
              ) : (
                <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
              )}
              <span className="text-sm font-medium text-gray-900 truncate">{notification.message}</span>
            </div>
            <span className="text-sm text-gray-500 shrink-0">{notification.status}</span>
          </div>
        ))}
        {!loading && filteredRows.length === 0 && (
          <div className="text-sm text-gray-500">No notifications in range.</div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Bell className="h-8 w-8 text-purple-600" />
          <h1 className="text-2xl font-semibold text-gray-900">System Notifications</h1>
        </div>
        <div className="space-x-4">
          <button
            type="button"
            onClick={() => {
              if (filteredRows.length === 0) {
                toast('Nothing to export.', 'info');
                return;
              }
              downloadCsv(columns, filteredRows, `system-notifications-${todayStamp()}`);
              toast(`Exported ${filteredRows.length} notifications.`);
            }}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Export Notifications
          </button>
          <button
            type="button"
            onClick={() => setTick((t) => t + 1)}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </button>
          <button
            type="button"
            onClick={() => toast('Create notifications via API or future composer UI.', 'info')}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-purple-600 hover:bg-purple-700"
          >
            <Settings className="h-4 w-4 mr-2" />
            Configure Alerts
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <MetricCard icon={Bell} title="Total (API)" value={loading ? '—' : formatInteger(total)} trend="system_notifications" />
        <MetricCard
          icon={AlertTriangle}
          title="Queued"
          value={loading ? '—' : formatInteger(queued)}
          trend="after date tab filter"
        />
        <MetricCard
          icon={MessageSquare}
          title="Unread (you)"
          value={loading ? '—' : formatInteger(unreadByMe)}
          trend="needs your acknowledgement"
        />
        <MetricCard icon={Users} title="Shown" value={loading ? '—' : formatInteger(filteredRows.length)} trend="" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-white p-6 rounded-lg shadow-sm">
            <h2 className="text-lg font-medium text-gray-900 mb-4">Notification volume</h2>
            <div className="h-64 bg-gray-50 rounded-lg flex items-center justify-center">
              <span className="text-gray-500 text-sm px-4 text-center">
                {loading ? 'Loading…' : `${formatInteger(filteredRows.length)} rows after filters`}
              </span>
            </div>
          </div>
        </div>
        <div className="lg:col-span-1">
          <ActiveNotifications />
        </div>
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={levelFilters}
        onClear={() => {
          setSelectedLevel('');
          setStartDate(() => {
            const d = new Date();
            d.setDate(d.getDate() - 30);
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
            <DataTable
              columns={[
                ...columns.slice(0, columns.length - 1),
                {
                  ...columns[columns.length - 1],
                  render: (_v: boolean, row: NotificationData) =>
                    row.readByMe ? (
                      <span className="inline-flex items-center text-xs text-green-700">
                        <CheckCircle className="h-4 w-4 mr-1" /> Read
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await monitoringApi.markNotificationRead(row.id);
                            toast('Marked as read.');
                            setTick((t) => t + 1);
                          } catch (err) {
                            toast(
                              `Failed to mark read: ${(err as Error)?.message ?? err}`,
                              'error'
                            );
                          }
                        }}
                        className="text-xs text-purple-600 hover:underline"
                      >
                        Mark as read
                      </button>
                    ),
                },
              ]}
              data={filteredRows}
            />
          )}
        </div>
      </div>

      <div className="bg-purple-50 border-l-4 border-purple-400 p-4">
        <div className="flex">
          <Bell className="h-5 w-5 text-purple-400" />
          <div className="ml-3">
            <h3 className="text-sm font-medium text-purple-800">PostgreSQL</h3>
            <div className="mt-2 text-sm text-purple-700">
              <p>
                Rows come from <code className="text-xs">system_notifications</code>. Date tabs narrow the client-side
                window; level filter hits the API.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
