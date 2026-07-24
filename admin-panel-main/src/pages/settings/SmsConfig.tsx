import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { FilterBar } from '../../components/FilterBar';
import { TabGroup } from '../../components/TabGroup';
import { MessageSquare, Send, AlertTriangle, CheckCircle, Save } from 'lucide-react';
import { toast } from '../../lib/toast';
import * as configurationsApi from '../../lib/api/configurations';
import * as settingsApi from '../../lib/api/settings';
import { useAuthStore } from '../../store/auth';
import { BulkSms } from './BulkSms';

interface SmsTemplateData {
  id: string;
  name: string;
  type: string;
  message: string;
  variables: string;
  status: string;
  lastModified: string;
}

const extractVariables = (body: string) =>
  Array.from(new Set((body.match(/\{[a-zA-Z0-9_]+\}/g) ?? []).map((m) => m.slice(1, -1)))).join(', ');

const mapTemplate = (t: configurationsApi.SmsTemplate): SmsTemplateData => ({
  id: t.id,
  name: t.name,
  type: t.language?.toUpperCase() || 'General',
  message: t.body,
  variables: extractVariables(t.body),
  status: t.status,
  lastModified: t.updated_at ? new Date(t.updated_at).toLocaleString() : '—',
});

const columns = [
  { header: 'Name', accessor: 'name' as const },
  { header: 'Type', accessor: 'type' as const },
  { header: 'Message', accessor: 'message' as const },
  { header: 'Variables', accessor: 'variables' as const },
  { header: 'Status', accessor: 'status' as const },
  { header: 'Last Modified', accessor: 'lastModified' as const },
];

const baseTabs = [
  { id: 'providers', label: 'Provider Config' },
  { id: 'templates', label: 'SMS Templates' },
  { id: 'logs', label: 'SMS Logs' },
];

const defaultSmsConfig: settingsApi.SmsAliasConfig = {
  provider: 'africastalking',
  api_key: '',
  username: '',
  sender_id: '',
  api_url: '',
  email_provider: '',
  smtp_host: '',
  smtp_port: 587,
  smtp_user: '',
  smtp_password: '',
  sms_events: [],
  email_events: [],
  sms_enabled: false,
  default_provider: 'sms',
  telegram: {
    enabled: false,
    bot_token: '',
    gateway_token: '',
    chat_config: '',
    api_url: '',
  },
  otp: {
    expiry_minutes: 5,
    code_length: 6,
    resend_cooldown_seconds: 60,
    max_resend_per_window: 3,
    resend_window_minutes: 15,
    resend_block_minutes: 15,
    max_verify_attempts: 5,
    verify_block_minutes: 15,
  },
};

const OTP_FIELDS: {
  key: keyof settingsApi.OtpSecurityConfig;
  label: string;
  min: number;
  max: number;
  hint: string;
}[] = [
  { key: 'expiry_minutes', label: 'OTP expiration (minutes)', min: 1, max: 60, hint: 'Code becomes invalid after this many minutes.' },
  { key: 'code_length', label: 'Code length (digits)', min: 4, max: 8, hint: 'Number of digits in the generated code.' },
  { key: 'resend_cooldown_seconds', label: 'Resend cooldown (seconds)', min: 10, max: 3600, hint: 'Minimum wait between two resend requests.' },
  { key: 'max_resend_per_window', label: 'Max resends per window', min: 1, max: 20, hint: 'Sends allowed inside the resend window.' },
  { key: 'resend_window_minutes', label: 'Resend window (minutes)', min: 1, max: 240, hint: 'Rolling window used to count resends.' },
  { key: 'resend_block_minutes', label: 'Resend block (minutes)', min: 1, max: 1440, hint: 'Block duration after exceeding the resend limit.' },
  { key: 'max_verify_attempts', label: 'Max wrong attempts', min: 1, max: 20, hint: 'Wrong entries allowed before verification is blocked.' },
  { key: 'verify_block_minutes', label: 'Verify block (minutes)', min: 1, max: 1440, hint: 'Block duration after too many wrong attempts.' },
];

const MetricCard = ({ icon: Icon, title, value, status }: { icon: any, title: string, value: string, status: 'success' | 'warning' | 'error' }) => (
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
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-xl font-semibold">{value}</p>
        </div>
      </div>
    </div>
  </div>
);

export function SmsConfig() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const canBulkSms = useAuthStore((s) => s.hasPermission('marketing.bulk_sms'));
  // The isolated Bulk SMS marketing module lives in its own tab. Shown only to
  // Super Admin (wildcard) or an Administrator granted `marketing.bulk_sms`.
  const tabs = useMemo(
    () =>
      canBulkSms
        ? [...baseTabs, { id: 'bulksms', label: 'Bulk SMS (Marketing)' }]
        : baseTabs,
    [canBulkSms]
  );
  const [activeTab, setActiveTab] = useState('providers');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [selectedType, setSelectedType] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [rows, setRows] = useState<SmsTemplateData[]>([]);
  const [providerConfig, setProviderConfig] =
    useState<settingsApi.SmsAliasConfig>(defaultSmsConfig);
  const [smsEventsText, setSmsEventsText] = useState('');
  const [emailEventsText, setEmailEventsText] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      configurationsApi.listSmsTemplates(),
      settingsApi.getSmsAliasConfig().catch(() => ({} as settingsApi.SmsAliasConfig)),
    ])
      .then(([tplRes, cfgRes]) => {
        if (cancelled) return;
        setRows((tplRes.items ?? []).map(mapTemplate));
        const merged = { ...defaultSmsConfig, ...(cfgRes ?? {}) };
        setProviderConfig(merged);
        setSmsEventsText((merged.sms_events ?? []).join(', '));
        setEmailEventsText((merged.email_events ?? []).join(', '));
      })
      .catch((err: Error) => toast(`Failed to load SMS config: ${err.message ?? err}`, 'error'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth]);

  const saveProviderConfig = async () => {
    setSavingConfig(true);
    try {
      const payload: settingsApi.SmsAliasConfig = {
        ...providerConfig,
        sms_events: smsEventsText
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
        email_events: emailEventsText
          .split(/[,\n]/)
          .map((s) => s.trim())
          .filter(Boolean),
      };
      // The backend validates SMS api_url as a URL; an empty string would
      // be rejected, so omit it when blank (the field is optional).
      if (!payload.api_url) delete payload.api_url;
      await settingsApi.updateSmsAliasConfig(payload);
      setProviderConfig(payload);
      toast('SMS / email provider config saved.');
    } catch (err) {
      toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const filters = [
    {
      label: 'Type',
      options: Array.from(new Set(rows.map((r) => r.type).filter(Boolean))),
      value: selectedType,
      onChange: setSelectedType,
    },
    {
      label: 'Status',
      options: Array.from(new Set(rows.map((r) => r.status).filter(Boolean))),
      value: selectedStatus,
      onChange: setSelectedStatus,
    },
  ];

  const filteredRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!selectedType || r.type === selectedType) &&
          (!selectedStatus || r.status === selectedStatus)
      ),
    [rows, selectedType, selectedStatus]
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-3">
          <MessageSquare className="h-8 w-8 text-blue-600" />
          <h1 className="text-2xl font-semibold text-gray-900">SMS Configuration</h1>
        </div>
        <div className="space-x-4">
          <button
            onClick={() => toast('Test SMS sent.')}
            className="inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
          >
            Test SMS
          </button>
          <button
            onClick={() => toast('Opening SMS template editor…')}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700"
          >
            Add Template
          </button>
        </div>
      </div>

      <div className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 ${activeTab === 'bulksms' ? 'hidden' : ''}`}>
        <MetricCard
          icon={Send}
          title="Messages Sent Today"
          value={loading ? '—' : String(filteredRows.length)}
          status="success"
        />
        <MetricCard
          icon={AlertTriangle}
          title="Failed Messages"
          value={loading ? '—' : String(filteredRows.filter((r) => /inactive|failed/i.test(r.status)).length)}
          status={filteredRows.some((r) => /inactive|failed/i.test(r.status)) ? 'error' : 'success'}
        />
        <MetricCard
          icon={CheckCircle}
          title="Delivery Rate"
          value={loading ? '—' : `${filteredRows.length ? Math.round((filteredRows.filter((r) => !/inactive|failed/i.test(r.status)).length * 100) / filteredRows.length) : 100}%`}
          status="success"
        />
        <MetricCard
          icon={MessageSquare}
          title="Active Templates"
          value={loading ? '—' : String(filteredRows.filter((r) => /active/i.test(r.status)).length)}
          status="success"
        />
      </div>

      <TabGroup
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {activeTab === 'bulksms' && <BulkSms />}

      {activeTab === 'providers' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <p className="text-xs text-gray-500">
            Mapped to <code>GET/PUT /api/admin/settings/sms</code>. Secrets are stored only on
            the backend; the API key field is sent back encrypted/masked.
          </p>

          {/* Provider master toggles — control which channel(s) are active
              and which one wins when both are enabled. */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
            <h3 className="text-md font-semibold">Notification Providers</h3>
            <p className="text-xs text-gray-500">
              When both providers are enabled, the selected default provider is used for OTP
              and notifications. When both are disabled, registration works without OTP and the
              Forgot Password option is hidden on the login page.
            </p>
            <label className="flex items-center justify-between border rounded-md bg-white p-3">
              <span className="text-gray-700 font-medium">Enable SMS</span>
              <input
                type="checkbox"
                checked={Boolean(providerConfig.sms_enabled)}
                onChange={(e) =>
                  setProviderConfig((p) => ({ ...p, sms_enabled: e.target.checked }))
                }
              />
            </label>
            <label className="flex items-center justify-between border rounded-md bg-white p-3">
              <span className="text-gray-700 font-medium">Enable Telegram Gateway</span>
              <input
                type="checkbox"
                checked={Boolean(providerConfig.telegram?.enabled)}
                onChange={(e) =>
                  setProviderConfig((p) => ({
                    ...p,
                    telegram: { ...(p.telegram ?? {}), enabled: e.target.checked },
                  }))
                }
              />
            </label>
            <label className="space-y-1 block">
              <span className="text-gray-700">Default provider (used when both are enabled)</span>
              <select
                value={providerConfig.default_provider ?? 'sms'}
                onChange={(e) =>
                  setProviderConfig((p) => ({
                    ...p,
                    default_provider: e.target.value as 'sms' | 'telegram',
                  }))
                }
                className="w-full rounded-md border-gray-300"
              >
                <option value="sms">SMS</option>
                <option value="telegram">Telegram Gateway</option>
              </select>
            </label>
          </div>

          <h3 className="text-md font-semibold pt-2">SMS Provider</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <label className="space-y-1">
              <span className="text-gray-700">SMS provider</span>
              <select
                value={providerConfig.provider ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({ ...p, provider: e.target.value }))
                }
                className="w-full rounded-md border-gray-300"
              >
                <option value="africastalking">Africa&apos;s Talking</option>
                <option value="twilio">Twilio</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">Sender ID</span>
              <input
                value={providerConfig.sender_id ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({ ...p, sender_id: e.target.value }))
                }
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">Username</span>
              <input
                value={providerConfig.username ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({ ...p, username: e.target.value }))
                }
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">API key</span>
              <input
                type="password"
                value={providerConfig.api_key ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({ ...p, api_key: e.target.value }))
                }
                placeholder="(set to rotate)"
                className="w-full rounded-md border-gray-300 font-mono"
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-gray-700">API URL (optional)</span>
              <input
                value={providerConfig.api_url ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({ ...p, api_url: e.target.value }))
                }
                placeholder="https://api.provider.com"
                className="w-full rounded-md border-gray-300"
              />
            </label>
          </div>

          <h3 className="text-md font-semibold pt-2">Email Provider</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <label className="space-y-1">
              <span className="text-gray-700">Email provider</span>
              <select
                value={providerConfig.email_provider ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({ ...p, email_provider: e.target.value }))
                }
                className="w-full rounded-md border-gray-300"
              >
                <option value="">— none —</option>
                <option value="sendgrid">SendGrid</option>
                <option value="smtp">Generic SMTP</option>
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">SMTP host</span>
              <input
                value={providerConfig.smtp_host ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({ ...p, smtp_host: e.target.value }))
                }
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">SMTP port</span>
              <input
                type="number"
                min={1}
                value={providerConfig.smtp_port ?? 587}
                onChange={(e) =>
                  setProviderConfig((p) => ({
                    ...p,
                    smtp_port: Number(e.target.value || 587),
                  }))
                }
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">SMTP user</span>
              <input
                value={providerConfig.smtp_user ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({ ...p, smtp_user: e.target.value }))
                }
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <label className="space-y-1 md:col-span-2">
              <span className="text-gray-700">SMTP password</span>
              <input
                type="password"
                value={providerConfig.smtp_password ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({ ...p, smtp_password: e.target.value }))
                }
                placeholder="(set to rotate)"
                className="w-full rounded-md border-gray-300 font-mono"
              />
            </label>
          </div>

          <h3 className="text-md font-semibold pt-2">Telegram Gateway</h3>
          <p className="text-xs text-gray-500">
            Prepared for future activation. Save your credentials now; delivery goes live once
            the Telegram integration is enabled — no code changes required. These fields are not
            validated yet.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <label className="space-y-1">
              <span className="text-gray-700">Bot Token</span>
              <input
                type="password"
                value={providerConfig.telegram?.bot_token ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({
                    ...p,
                    telegram: { ...(p.telegram ?? {}), bot_token: e.target.value },
                  }))
                }
                placeholder="Bot token (placeholder)"
                className="w-full rounded-md border-gray-300 font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">Gateway Token</span>
              <input
                type="password"
                value={providerConfig.telegram?.gateway_token ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({
                    ...p,
                    telegram: { ...(p.telegram ?? {}), gateway_token: e.target.value },
                  }))
                }
                placeholder="Gateway token (placeholder)"
                className="w-full rounded-md border-gray-300 font-mono"
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">API URL</span>
              <input
                value={providerConfig.telegram?.api_url ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({
                    ...p,
                    telegram: { ...(p.telegram ?? {}), api_url: e.target.value },
                  }))
                }
                placeholder="https://gateway.telegram.org (placeholder)"
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">Chat Configuration</span>
              <input
                value={providerConfig.telegram?.chat_config ?? ''}
                onChange={(e) =>
                  setProviderConfig((p) => ({
                    ...p,
                    telegram: { ...(p.telegram ?? {}), chat_config: e.target.value },
                  }))
                }
                placeholder="Chat/route mapping (placeholder)"
                className="w-full rounded-md border-gray-300"
              />
            </label>
          </div>

          <h3 className="text-md font-semibold pt-2">OTP Security</h3>
          <p className="text-xs text-gray-500">
            These rules apply to every OTP (registration, login, forgot password) regardless of
            the active provider (SMS or Telegram Gateway). Codes are single-use, hashed at rest,
            and expire automatically.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
            {OTP_FIELDS.map((f) => (
              <label key={f.key} className="space-y-1">
                <span className="text-gray-700">{f.label}</span>
                <input
                  type="number"
                  min={f.min}
                  max={f.max}
                  value={providerConfig.otp?.[f.key] ?? ''}
                  onChange={(e) =>
                    setProviderConfig((p) => ({
                      ...p,
                      otp: {
                        ...(p.otp ?? {}),
                        [f.key]: Number(e.target.value || f.min),
                      },
                    }))
                  }
                  className="w-full rounded-md border-gray-300"
                />
                <span className="block text-[11px] text-gray-400">{f.hint}</span>
              </label>
            ))}
          </div>

          <h3 className="text-md font-semibold pt-2">Notification Triggers</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <label className="space-y-1">
              <span className="text-gray-700">
                SMS events (comma- or newline-separated)
              </span>
              <textarea
                rows={3}
                value={smsEventsText}
                onChange={(e) => setSmsEventsText(e.target.value)}
                placeholder="deposit_approved, withdrawal_paid, bet_won"
                className="w-full rounded-md border-gray-300 font-mono text-xs"
              />
            </label>
            <label className="space-y-1">
              <span className="text-gray-700">
                Email events (comma- or newline-separated)
              </span>
              <textarea
                rows={3}
                value={emailEventsText}
                onChange={(e) => setEmailEventsText(e.target.value)}
                placeholder="account_locked, kyc_required, large_win"
                className="w-full rounded-md border-gray-300 font-mono text-xs"
              />
            </label>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => void saveProviderConfig()}
              disabled={savingConfig}
              className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
            >
              <Save className="h-4 w-4 mr-2" />
              {savingConfig ? 'Saving...' : 'Save Provider Config'}
            </button>
          </div>
        </div>
      )}

      {(activeTab === 'templates' || activeTab === 'logs') && (
        <>
          <FilterBar
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            filters={filters}
            onClear={() => {
              setSelectedType('');
              setSelectedStatus('');
              setStartDate(new Date());
              setEndDate(new Date());
            }}
          />

          <div className="bg-white rounded-lg shadow">
            <DataTable columns={columns} data={filteredRows} />
          </div>
        </>
      )}
    </div>
  );
}
