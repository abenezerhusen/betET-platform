import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { Shield, Key, Lock, UserCheck, AlertTriangle, Save } from 'lucide-react';
import { toast } from '../../lib/toast';
import * as settingsApi from '../../lib/api/settings';
import * as auditApi from '../../lib/api/audit-logs';
import { useAuthStore } from '../../store/auth';

interface SecurityPolicyData {
  id: string;
  name: string;
  description: string;
  type: string;
  status: string;
  lastModified: string;
  modifiedBy: string;
}

const tabs = [
  { id: 'policy', label: 'Policy' },
  { id: 'authentication', label: 'Authentication' },
  { id: 'access-control', label: 'Access Control' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'audit', label: 'Audit Log' },
];

const defaultSecurity: settingsApi.SecurityConfig = {
  require_2fa_admin: true,
  require_2fa_cashier: false,
  require_2fa_users: false,
  session_duration_hours: 8,
  max_login_attempts: 5,
  lockout_duration_minutes: 15,
  ip_whitelist_enabled: false,
  ip_allowlist: [],
};

const SecurityCard = ({
  icon: Icon,
  title,
  value,
  status,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  value: string;
  status: 'success' | 'warning' | 'error';
}) => (
  <div className="bg-white p-6 rounded-lg shadow-sm">
    <div className="flex items-center justify-between">
      <div className="flex items-center space-x-3">
        <div className={`p-2 rounded-lg ${status === 'success' ? 'bg-green-50' : status === 'warning' ? 'bg-yellow-50' : 'bg-red-50'}`}>
          <Icon className={`h-6 w-6 ${status === 'success' ? 'text-green-600' : status === 'warning' ? 'text-yellow-600' : 'text-red-600'}`} />
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900">{title}</h3>
          <p className="mt-1 text-sm text-gray-500">{value}</p>
        </div>
      </div>
    </div>
  </div>
);

export function SecuritySettings() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('policy');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedType, setSelectedType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [rows, setRows] = useState<SecurityPolicyData[]>([]);
  const [policy, setPolicy] = useState<settingsApi.SecurityConfig>(defaultSecurity);
  const [ipListText, setIpListText] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingPolicy, setSavingPolicy] = useState(false);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      settingsApi.listSettings({ prefix: 'security.' }),
      auditApi.listAuditLogs({ action: 'admin.security.update', limit: 50 }).catch(() => ({ items: [] as any[] })),
      settingsApi.getSecurityConfig().catch(() => ({} as settingsApi.SecurityConfig)),
    ])
      .then(([settingsRes, auditRes, policyRes]) => {
        if (cancelled) return;
        const byKey = new Map((auditRes.items ?? []).map((a: any) => [String(a.resource_id ?? a.resource ?? ''), a]));
        const mapped = (settingsRes.items ?? []).map((s, idx) => {
          const a = byKey.get(s.key);
          return {
            id: s.id ?? String(idx),
            name: s.key.replace(/^security\./, ''),
            description: typeof s.value === 'string' ? s.value : JSON.stringify(s.value),
            type: s.key.includes('auth') ? 'Authentication' : s.key.includes('access') ? 'Access Control' : 'Permissions',
            status: 'Active',
            lastModified: s.updated_at ? new Date(s.updated_at).toLocaleString() : '—',
            modifiedBy: String(a?.actor_id ?? 'System'),
          };
        });
        setRows(mapped);
        const merged = { ...defaultSecurity, ...(policyRes ?? {}) };
        setPolicy(merged);
        setIpListText((merged.ip_allowlist ?? []).join('\n'));
      })
      .catch((err: Error) => toast(`Failed to load security settings: ${err.message ?? err}`, 'error'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth]);

  const savePolicy = async () => {
    setSavingPolicy(true);
    try {
      const ip_allowlist = ipListText
        .split(/\r?\n|,/) // newline or comma separated
        .map((s) => s.trim())
        .filter(Boolean);
      const payload = { ...policy, ip_allowlist };
      await settingsApi.updateSecurityConfig(payload);
      setPolicy(payload);
      toast('Security policy saved.');
    } catch (err) {
      toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSavingPolicy(false);
    }
  };

  const filters = [
    { label: 'Type', options: ['Authentication', 'Access Control', 'Permissions'], value: selectedType, onChange: setSelectedType },
    { label: 'Status', options: ['Active', 'Inactive'], value: selectedStatus, onChange: setSelectedStatus },
  ];

  const filtered = useMemo(
    () => rows.filter((r) => (!selectedType || r.type === selectedType) && (!selectedStatus || r.status === selectedStatus)),
    [rows, selectedType, selectedStatus]
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <Shield className="h-8 w-8 text-indigo-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Security Settings</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <SecurityCard icon={Key} title="Authentication Status" value={`${rows.filter((r) => r.type === 'Authentication').length} policy keys`} status="success" />
        <SecurityCard icon={Lock} title="Access Control" value={`${rows.filter((r) => r.type === 'Access Control').length} policy keys`} status="success" />
        <SecurityCard icon={UserCheck} title="User Sessions" value="Monitored via auth/audit APIs" status="warning" />
        <SecurityCard icon={AlertTriangle} title="Security Alerts" value="Review audit tab for recent updates" status="error" />
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'policy' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <p className="text-xs text-gray-500">
            Mapped to <code>GET/PUT /api/admin/settings/security</code>. The auth middleware reads
            these on every login, so changes take effect immediately for new sessions.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <label className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2">
              <span>Require 2FA — Admins</span>
              <input
                type="checkbox"
                checked={Boolean(policy.require_2fa_admin)}
                onChange={(e) => setPolicy((p) => ({ ...p, require_2fa_admin: e.target.checked }))}
              />
            </label>
            <label className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2">
              <span>Require 2FA — Cashiers</span>
              <input
                type="checkbox"
                checked={Boolean(policy.require_2fa_cashier)}
                onChange={(e) =>
                  setPolicy((p) => ({ ...p, require_2fa_cashier: e.target.checked }))
                }
              />
            </label>
            <label className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2">
              <span>Require 2FA — Online users</span>
              <input
                type="checkbox"
                checked={Boolean(policy.require_2fa_users)}
                onChange={(e) =>
                  setPolicy((p) => ({ ...p, require_2fa_users: e.target.checked }))
                }
              />
            </label>
            <label className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2">
              <span>IP whitelist enabled</span>
              <input
                type="checkbox"
                checked={Boolean(policy.ip_whitelist_enabled)}
                onChange={(e) =>
                  setPolicy((p) => ({ ...p, ip_whitelist_enabled: e.target.checked }))
                }
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">Session duration (hours)</span>
              <input
                type="number"
                min={1}
                value={policy.session_duration_hours ?? 0}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    session_duration_hours: Number(e.target.value || 0),
                  }))
                }
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">Max login attempts</span>
              <input
                type="number"
                min={1}
                value={policy.max_login_attempts ?? 0}
                onChange={(e) =>
                  setPolicy((p) => ({ ...p, max_login_attempts: Number(e.target.value || 0) }))
                }
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">Lockout duration (minutes)</span>
              <input
                type="number"
                min={1}
                value={policy.lockout_duration_minutes ?? 0}
                onChange={(e) =>
                  setPolicy((p) => ({
                    ...p,
                    lockout_duration_minutes: Number(e.target.value || 0),
                  }))
                }
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-gray-700">
                Admin IP allowlist (one per line; only enforced when toggle is on)
              </span>
              <textarea
                value={ipListText}
                onChange={(e) => setIpListText(e.target.value)}
                rows={4}
                placeholder="10.0.0.0/8&#10;203.0.113.4"
                className="w-full rounded-md border-gray-300 font-mono text-xs"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => void savePolicy()}
              disabled={savingPolicy}
              className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
            >
              <Save className="h-4 w-4 mr-2" />
              {savingPolicy ? 'Saving...' : 'Save Policy'}
            </button>
          </div>
        </div>
      )}

      <FilterBar
        startDate={startDate}
        endDate={endDate}
        onStartDateChange={setStartDate}
        onEndDateChange={setEndDate}
        filters={filters}
      />

      <div className="bg-white rounded-lg shadow p-6">
        <DataTable
          columns={[
            { header: 'Name', accessor: 'name' as const },
            { header: 'Description', accessor: 'description' as const },
            { header: 'Type', accessor: 'type' as const },
            { header: 'Status', accessor: 'status' as const },
            { header: 'Last Modified', accessor: 'lastModified' as const },
            { header: 'Modified By', accessor: 'modifiedBy' as const },
          ]}
          data={filtered}
        />
        {loading && <div className="text-sm text-gray-500 mt-4">Loading security policies…</div>}
      </div>
    </div>
  );
}
