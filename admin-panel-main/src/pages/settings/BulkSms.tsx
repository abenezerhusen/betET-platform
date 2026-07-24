import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Send,
  Save,
  Plus,
  Trash2,
  Pencil,
  Upload,
  RefreshCw,
  PlugZap,
  MessageSquareText,
  ListChecks,
  History as HistoryIcon,
  BarChart3,
  X,
  CheckCircle2,
  XCircle,
  Ban,
} from 'lucide-react';
import { TabGroup } from '../../components/TabGroup';
import { toast } from '../../lib/toast';
import { ApiError } from '../../lib/api/client';
import * as api from '../../lib/api/bulkSms';

/* -------------------------------------------------------------------------- */
/*  Client-side phone helpers (mirror backend rules for the import preview)   */
/* -------------------------------------------------------------------------- */
const E164 = /^\+\d{7,15}$/;

function normalizePhone(raw: string, defaultCountryCode: string): string | null {
  if (!raw) return null;
  let s = String(raw).replace(/[\s\-().]/g, '');
  if (!s) return null;
  const ccDigits = defaultCountryCode.replace(/[^\d]/g, '');
  const cc = ccDigits ? `+${ccDigits}` : '';
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (s.startsWith('+')) return E164.test(s) ? s : null;
  if (/[^\d]/.test(s)) return null;
  if (s.startsWith('0')) {
    if (!cc) return null;
    s = `${cc}${s.slice(1)}`;
  } else if (ccDigits && s.startsWith(ccDigits)) {
    s = `+${s}`;
  } else if (cc) {
    s = `${cc}${s}`;
  } else {
    s = `+${s}`;
  }
  return E164.test(s) ? s : null;
}

const errMsg = (e: unknown, fallback: string) =>
  e instanceof ApiError ? e.message : e instanceof Error ? e.message : fallback;

const SUB_TABS = [
  { id: 'gateway', label: 'Gateway Settings' },
  { id: 'templates', label: 'SMS Templates' },
  { id: 'campaign', label: 'Create Campaign' },
  { id: 'queue', label: 'SMS Queue' },
  { id: 'history', label: 'SMS History' },
  { id: 'reports', label: 'Reports' },
];

const badge = (status: string) => {
  const s = status.toLowerCase();
  const cls =
    s === 'sent' || s === 'completed'
      ? 'bg-green-100 text-green-700'
      : s === 'failed' || s === 'cancelled'
        ? 'bg-red-100 text-red-700'
        : s === 'sending' || s === 'processing'
          ? 'bg-blue-100 text-blue-700'
          : 'bg-gray-100 text-gray-600';
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {status}
    </span>
  );
};

/* ========================================================================== */
/*  Gateway Settings                                                          */
/* ========================================================================== */
function GatewaySettingsSection() {
  const [cfg, setCfg] = useState<api.GatewaySettings | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [sendingTest, setSendingTest] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .getGatewaySettings()
      .then(setCfg)
      .catch((e) => toast(`Failed to load gateway settings: ${errMsg(e, '')}`, 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const patch = (p: Partial<api.GatewaySettings>) =>
    setCfg((c) => (c ? { ...c, ...p } : c));

  const save = async () => {
    if (!cfg) return;
    setSaving(true);
    try {
      const saved = await api.saveGatewaySettings({
        enabled: cfg.enabled,
        gateway_name: cfg.gateway_name,
        api_url: cfg.api_url,
        api_key: apiKey || undefined,
        device_id: cfg.device_id,
        sender_number: cfg.sender_number,
        default_country_code: cfg.default_country_code,
        max_sms_per_day: cfg.max_sms_per_day,
        delay_ms: cfg.delay_ms,
      });
      setCfg(saved);
      setApiKey('');
      toast('Gateway settings saved.');
    } catch (e) {
      toast(`Save failed: ${errMsg(e, '')}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.testConnection();
      if (r.ok) toast('Connection OK — gateway device reachable.');
      else toast(`Connection failed: ${r.error ?? `HTTP ${r.status}`}`, 'error');
    } catch (e) {
      toast(`Connection failed: ${errMsg(e, '')}`, 'error');
    } finally {
      setTesting(false);
    }
  };

  const sendTest = async () => {
    if (!testPhone.trim()) {
      toast('Enter a phone number for the test SMS.', 'error');
      return;
    }
    setSendingTest(true);
    try {
      const r = await api.sendTestSms(testPhone.trim());
      if (r.ok) toast(`Test SMS accepted for ${r.phone ?? testPhone}.`);
      else toast(`Test SMS failed: ${r.error ?? `HTTP ${r.status}`}`, 'error');
    } catch (e) {
      toast(`Test SMS failed: ${errMsg(e, '')}`, 'error');
    } finally {
      setSendingTest(false);
    }
  };

  if (loading || !cfg) {
    return <div className="bg-white rounded-lg shadow p-6 text-sm text-gray-500">Loading…</div>;
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-5">
      <p className="text-xs text-gray-500">
        Standalone phone SMS gateway (e.g. <code>TextBee</code>) used ONLY for admin bulk
        marketing campaigns. It is completely separate from the OTP SMS / Telegram providers and
        is never used for login, registration, password-reset or security messages.
      </p>

      <label className="flex items-center justify-between border rounded-md bg-gray-50 p-3">
        <span className="text-gray-700 font-medium">Enable Bulk SMS Gateway</span>
        <input
          type="checkbox"
          checked={cfg.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <label className="space-y-1">
          <span className="text-gray-700">Gateway name</span>
          <input
            value={cfg.gateway_name}
            onChange={(e) => patch({ gateway_name: e.target.value })}
            className="w-full rounded-md border-gray-300"
          />
        </label>
        <label className="space-y-1">
          <span className="text-gray-700">API URL</span>
          <input
            value={cfg.api_url}
            onChange={(e) => patch({ api_url: e.target.value })}
            placeholder="https://api.textbee.dev/api/v1"
            className="w-full rounded-md border-gray-300"
          />
        </label>
        <label className="space-y-1">
          <span className="text-gray-700">
            API key {cfg.has_api_key && <span className="text-gray-400">({cfg.api_key_masked})</span>}
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={cfg.has_api_key ? '(set to rotate)' : 'Paste API key'}
            className="w-full rounded-md border-gray-300 font-mono"
          />
        </label>
        <label className="space-y-1">
          <span className="text-gray-700">Device ID</span>
          <input
            value={cfg.device_id}
            onChange={(e) => patch({ device_id: e.target.value })}
            className="w-full rounded-md border-gray-300 font-mono"
          />
        </label>
        <label className="space-y-1">
          <span className="text-gray-700">Sender number / SIM</span>
          <input
            value={cfg.sender_number}
            onChange={(e) => patch({ sender_number: e.target.value })}
            className="w-full rounded-md border-gray-300"
          />
        </label>
        <label className="space-y-1">
          <span className="text-gray-700">Default country code</span>
          <input
            value={cfg.default_country_code}
            onChange={(e) => patch({ default_country_code: e.target.value })}
            placeholder="+251"
            className="w-full rounded-md border-gray-300"
          />
        </label>
        <label className="space-y-1">
          <span className="text-gray-700">Max SMS per day</span>
          <input
            type="number"
            min={0}
            value={cfg.max_sms_per_day}
            onChange={(e) => patch({ max_sms_per_day: Number(e.target.value || 0) })}
            className="w-full rounded-md border-gray-300"
          />
        </label>
        <label className="space-y-1">
          <span className="text-gray-700">Delay between messages (ms)</span>
          <input
            type="number"
            min={0}
            value={cfg.delay_ms}
            onChange={(e) => patch({ delay_ms: Number(e.target.value || 0) })}
            className="w-full rounded-md border-gray-300"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2 border-t">
        <button
          onClick={() => void save()}
          disabled={saving}
          className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
        >
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
        <button
          onClick={() => void test()}
          disabled={testing}
          className="inline-flex items-center px-4 py-2 rounded-md border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
        >
          <PlugZap className="h-4 w-4 mr-2" />
          {testing ? 'Testing…' : 'Test Connection'}
        </button>
        <div className="flex items-center gap-2 ml-auto">
          <input
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            placeholder="+2519..."
            className="rounded-md border-gray-300 text-sm"
          />
          <button
            onClick={() => void sendTest()}
            disabled={sendingTest}
            className="inline-flex items-center px-4 py-2 rounded-md border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            <Send className="h-4 w-4 mr-2" />
            {sendingTest ? 'Sending…' : 'Send Test SMS'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  Templates                                                                 */
/* ========================================================================== */
function TemplatesSection() {
  const [items, setItems] = useState<api.Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<api.Template | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    api
      .listTemplates({ limit: 100 })
      .then((r) => setItems(r.items))
      .catch((e) => toast(`Failed to load templates: ${errMsg(e, '')}`, 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setName('');
    setBody('');
  };
  const openEdit = (t: api.Template) => {
    setEditing(t);
    setCreating(true);
    setName(t.name);
    setBody(t.body);
  };

  const submit = async () => {
    if (!name.trim() || !body.trim()) {
      toast('Template name and message are required.', 'error');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        await api.updateTemplate(editing.id, { name: name.trim(), body });
        toast('Template updated.');
      } else {
        await api.createTemplate({ name: name.trim(), body });
        toast('Template created.');
      }
      setCreating(false);
      load();
    } catch (e) {
      toast(`Save failed: ${errMsg(e, '')}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (t: api.Template) => {
    if (!window.confirm(`Delete template "${t.name}"?`)) return;
    try {
      await api.deleteTemplate(t.id);
      toast('Template deleted.');
      load();
    } catch (e) {
      toast(`Delete failed: ${errMsg(e, '')}`, 'error');
    }
  };

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-md font-semibold">SMS Templates</h3>
        <button
          onClick={openCreate}
          className="inline-flex items-center px-3 py-2 rounded-md bg-blue-600 text-white text-sm"
        >
          <Plus className="h-4 w-4 mr-1" /> New Template
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Use <code>{'{name}'}</code>, <code>{'{username}'}</code> and any other{' '}
        <code>{'{variable}'}</code> that you supply per-recipient from the imported file.
      </p>

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-sm text-gray-500">No templates yet.</div>
      ) : (
        <div className="divide-y border rounded-md">
          {items.map((t) => (
            <div key={t.id} className="flex items-start justify-between p-3">
              <div className="min-w-0">
                <p className="font-medium text-gray-900">{t.name}</p>
                <p className="text-sm text-gray-500 truncate max-w-2xl">{t.body}</p>
                <p className="text-xs text-gray-400 mt-1">{t.body.length} chars</p>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <button
                  onClick={() => openEdit(t)}
                  className="p-2 text-gray-500 hover:text-blue-600"
                  title="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  onClick={() => void remove(t)}
                  className="p-2 text-gray-500 hover:text-red-600"
                  title="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-lg p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-semibold">{editing ? 'Edit Template' : 'New Template'}</h4>
              <button onClick={() => setCreating(false)} className="text-gray-400 hover:text-gray-600">
                <X className="h-5 w-5" />
              </button>
            </div>
            <label className="space-y-1 block text-sm">
              <span className="text-gray-700">Template name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <label className="space-y-1 block text-sm">
              <span className="text-gray-700">Message body ({body.length} chars)</span>
              <textarea
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Hello {name}, new promotions are available on our platform."
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setCreating(false)}
                className="px-4 py-2 rounded-md border border-gray-300 text-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={() => void submit()}
                disabled={saving}
                className="px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Create Campaign (+ Excel import)                                          */
/* ========================================================================== */
interface ParsedImport {
  recipients: api.Recipient[];
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
}

function CreateCampaignSection({ onCreated }: { onCreated: () => void }) {
  const [templates, setTemplates] = useState<api.Template[]>([]);
  const [gateway, setGateway] = useState<api.GatewaySettings | null>(null);
  const [name, setName] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [message, setMessage] = useState('');
  const [parsed, setParsed] = useState<ParsedImport | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    Promise.all([api.listTemplates({ limit: 100 }), api.getGatewaySettings()])
      .then(([t, g]) => {
        setTemplates(t.items);
        setGateway(g);
      })
      .catch((e) => toast(`Failed to load: ${errMsg(e, '')}`, 'error'));
  }, []);

  const cc = gateway?.default_country_code ?? '+251';

  const onSelectTemplate = (id: string) => {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) setMessage(t.body);
  };

  const handleFile = async (file: File) => {
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: '',
      });

      const findKey = (obj: Record<string, unknown>, candidates: string[]) => {
        const keys = Object.keys(obj);
        for (const c of candidates) {
          const hit = keys.find((k) => k.trim().toLowerCase() === c);
          if (hit) return hit;
        }
        return null;
      };

      const seen = new Set<string>();
      const recipients: api.Recipient[] = [];
      let invalid = 0;
      let duplicates = 0;
      const total = rows.length;

      for (const row of rows) {
        const phoneKey = findKey(row, ['phone', 'phone number', 'mobile', 'msisdn', 'number']);
        const rawPhone = phoneKey ? String(row[phoneKey] ?? '') : String(Object.values(row)[0] ?? '');
        const phone = normalizePhone(rawPhone, cc);
        if (!phone) {
          invalid += 1;
          continue;
        }
        if (seen.has(phone)) {
          duplicates += 1;
          continue;
        }
        seen.add(phone);
        const vars: Record<string, string> = {};
        for (const [k, v] of Object.entries(row)) {
          if (k === phoneKey) continue;
          vars[k.trim().toLowerCase()] = String(v ?? '');
        }
        recipients.push({ phone, vars });
      }

      setParsed({ recipients, total, valid: recipients.length, invalid, duplicates });
      if (recipients.length === 0) {
        toast('No valid phone numbers found in the file.', 'error');
      } else {
        toast(`Imported ${recipients.length} valid numbers.`);
      }
    } catch (e) {
      toast(`Failed to read file: ${errMsg(e, '')}`, 'error');
    }
  };

  const start = async () => {
    if (!name.trim()) return toast('Campaign name is required.', 'error');
    if (!message.trim()) return toast('Message is required.', 'error');
    if (!parsed || parsed.recipients.length === 0)
      return toast('Upload a phone list with at least one valid number.', 'error');
    if (!window.confirm(`Send this campaign to ${parsed.valid} recipients?`)) return;

    setBusy(true);
    try {
      const res = await api.createCampaign({
        name: name.trim(),
        template_id: templateId || undefined,
        message,
        recipients: parsed.recipients,
        start: true,
      });
      toast(`Campaign queued: ${res.import.valid} recipients.`);
      setName('');
      setMessage('');
      setTemplateId('');
      setParsed(null);
      if (fileRef.current) fileRef.current.value = '';
      onCreated();
    } catch (e) {
      toast(`Failed to start campaign: ${errMsg(e, '')}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  const estimatedSms = parsed?.valid ?? 0;
  const perMsg = Math.max(1, Math.ceil(message.length / 160));

  return (
    <div className="bg-white rounded-lg shadow p-6 space-y-4">
      {!gateway?.enabled && (
        <div className="rounded-md bg-yellow-50 border border-yellow-200 p-3 text-sm text-yellow-800">
          The bulk SMS gateway is disabled. Enable it in <strong>Gateway Settings</strong> before
          starting a campaign.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
        <label className="space-y-1">
          <span className="text-gray-700">Campaign name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border-gray-300"
          />
        </label>
        <label className="space-y-1">
          <span className="text-gray-700">Template (optional)</span>
          <select
            value={templateId}
            onChange={(e) => onSelectTemplate(e.target.value)}
            className="w-full rounded-md border-gray-300"
          >
            <option value="">— write a custom message —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="space-y-1 block text-sm">
        <span className="text-gray-700">Message ({message.length} chars · ~{perMsg} SMS each)</span>
        <textarea
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Hello {name}, new promotions are available on our platform."
          className="w-full rounded-md border-gray-300"
        />
      </label>

      <div className="rounded-md border border-dashed border-gray-300 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-gray-800">Upload phone list (.xlsx / .csv)</p>
            <p className="text-xs text-gray-500">
              A column named <code>phone</code> is used for numbers; other columns become{' '}
              <code>{'{variables}'}</code>. Country code {cc} is applied automatically when missing.
            </p>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center px-3 py-2 rounded-md border border-gray-300 text-gray-700 bg-white hover:bg-gray-50 text-sm"
          >
            <Upload className="h-4 w-4 mr-1" /> Choose File
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
            }}
          />
        </div>

        {parsed && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
            {[
              ['Total Numbers', parsed.total, 'text-gray-900'],
              ['Valid Numbers', parsed.valid, 'text-green-600'],
              ['Invalid Numbers', parsed.invalid, 'text-red-600'],
              ['Duplicates Removed', parsed.duplicates, 'text-yellow-600'],
            ].map(([label, val, cls]) => (
              <div key={label as string} className="rounded-md bg-gray-50 p-3 text-center">
                <p className={`text-xl font-semibold ${cls}`}>{val as number}</p>
                <p className="text-xs text-gray-500">{label as string}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-md bg-gray-50 p-4 grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div>
          <p className="text-gray-500">Total Recipients</p>
          <p className="text-lg font-semibold">{estimatedSms}</p>
        </div>
        <div>
          <p className="text-gray-500">Estimated SMS Count</p>
          <p className="text-lg font-semibold">{estimatedSms * perMsg}</p>
        </div>
        <div>
          <p className="text-gray-500">Daily Limit</p>
          <p className="text-lg font-semibold">{gateway?.max_sms_per_day ?? '—'}</p>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={() => void start()}
          disabled={busy}
          className="inline-flex items-center px-5 py-2.5 rounded-md bg-green-600 text-white font-medium disabled:bg-gray-300"
        >
          <Send className="h-4 w-4 mr-2" />
          {busy ? 'Starting…' : 'START CAMPAIGN'}
        </button>
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  Campaigns list + Queue + History                                          */
/* ========================================================================== */
function Pager({
  page,
  total,
  limit,
  onPage,
}: {
  page: number;
  total: number;
  limit: number;
  onPage: (p: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-gray-600">
      <span>
        {total} total · page {page}/{pages}
      </span>
      <div className="flex gap-2">
        <button
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          className="px-3 py-1 rounded border disabled:opacity-40"
        >
          Prev
        </button>
        <button
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          className="px-3 py-1 rounded border disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}

function CampaignsQueueSection({ refreshKey }: { refreshKey: number }) {
  const [campaigns, setCampaigns] = useState<api.Campaign[]>([]);
  const [queue, setQueue] = useState<api.QueueRow[]>([]);
  const [qTotal, setQTotal] = useState(0);
  const [qPage, setQPage] = useState(1);
  const [selected, setSelected] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const LIMIT = 20;

  const loadCampaigns = () =>
    api
      .listCampaigns({ limit: 50 })
      .then((r) => setCampaigns(r.items))
      .catch((e) => toast(`Failed to load campaigns: ${errMsg(e, '')}`, 'error'));

  const loadQueue = () =>
    api
      .listQueue({ page: qPage, limit: LIMIT, campaign_id: selected || undefined })
      .then((r) => {
        setQueue(r.items);
        setQTotal(r.total);
      })
      .catch((e) => toast(`Failed to load queue: ${errMsg(e, '')}`, 'error'));

  useEffect(() => {
    setLoading(true);
    Promise.all([loadCampaigns(), loadQueue()]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey, qPage, selected]);

  const cancel = async (id: string) => {
    if (!window.confirm('Cancel this campaign? Pending messages will not be sent.')) return;
    try {
      await api.cancelCampaign(id);
      toast('Campaign cancelled.');
      loadCampaigns();
      loadQueue();
    } catch (e) {
      toast(`Cancel failed: ${errMsg(e, '')}`, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg shadow">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-md font-semibold">Campaigns</h3>
          <button
            onClick={() => {
              loadCampaigns();
              loadQueue();
            }}
            className="inline-flex items-center text-sm text-gray-600 hover:text-blue-600"
          >
            <RefreshCw className="h-4 w-4 mr-1" /> Refresh
          </button>
        </div>
        {loading ? (
          <div className="p-4 text-sm text-gray-500">Loading…</div>
        ) : campaigns.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">No campaigns yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Name</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Recipients</th>
                  <th className="px-4 py-2 text-right">Sent</th>
                  <th className="px-4 py-2 text-right">Failed</th>
                  <th className="px-4 py-2 text-left">Created</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {campaigns.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-2">{badge(c.status)}</td>
                    <td className="px-4 py-2 text-right">{c.total_recipients}</td>
                    <td className="px-4 py-2 text-right text-green-600">{c.sent_count}</td>
                    <td className="px-4 py-2 text-right text-red-600">{c.failed_count}</td>
                    <td className="px-4 py-2 text-gray-500">
                      {new Date(c.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => setSelected(selected === c.id ? '' : c.id)}
                        className="text-blue-600 text-xs mr-3"
                      >
                        {selected === c.id ? 'Clear filter' : 'View queue'}
                      </button>
                      {['queued', 'sending'].includes(c.status) && (
                        <button
                          onClick={() => void cancel(c.id)}
                          className="inline-flex items-center text-red-600 text-xs"
                        >
                          <Ban className="h-3.5 w-3.5 mr-1" /> Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-lg shadow">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-md font-semibold">
            Send Queue {selected && <span className="text-xs text-gray-400">(filtered)</span>}
          </h3>
        </div>
        {queue.length === 0 ? (
          <div className="p-4 text-sm text-gray-500">Queue is empty.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-2 text-left">Campaign</th>
                  <th className="px-4 py-2 text-left">Phone</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Attempts</th>
                  <th className="px-4 py-2 text-left">Error</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {queue.map((q) => (
                  <tr key={q.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-700">{q.campaign_name ?? '—'}</td>
                    <td className="px-4 py-2 font-mono">{q.phone}</td>
                    <td className="px-4 py-2">{badge(q.status)}</td>
                    <td className="px-4 py-2 text-right">{q.attempts}</td>
                    <td className="px-4 py-2 text-red-500 text-xs">{q.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pager page={qPage} total={qTotal} limit={LIMIT} onPage={setQPage} />
          </div>
        )}
      </div>
    </div>
  );
}

function HistorySection({ refreshKey }: { refreshKey: number }) {
  const [logs, setLogs] = useState<api.LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const LIMIT = 25;

  const load = () => {
    setLoading(true);
    api
      .listLogs({ page, limit: LIMIT, status: status || undefined, search: search || undefined })
      .then((r) => {
        setLogs(r.items);
        setTotal(r.total);
      })
      .catch((e) => toast(`Failed to load history: ${errMsg(e, '')}`, 'error'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [refreshKey, page, status]);

  const exportCsv = () => {
    const header = ['Campaign', 'Phone', 'Message', 'Status', 'Error', 'Sent Time'];
    const rows = logs.map((l) => [
      l.campaign_name ?? '',
      l.phone,
      l.message.replace(/\n/g, ' '),
      l.status,
      l.error ?? '',
      l.sent_at ? new Date(l.sent_at).toLocaleString() : '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'SMS History');
    XLSX.writeFile(wb, `bulk-sms-history-page-${page}.xlsx`);
  };

  return (
    <div className="bg-white rounded-lg shadow">
      <div className="flex flex-wrap items-center gap-3 p-4 border-b">
        <h3 className="text-md font-semibold mr-auto">SMS History</h3>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (setPage(1), load())}
          placeholder="Search phone…"
          className="rounded-md border-gray-300 text-sm"
        />
        <select
          value={status}
          onChange={(e) => {
            setPage(1);
            setStatus(e.target.value);
          }}
          className="rounded-md border-gray-300 text-sm"
        >
          <option value="">All statuses</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
        <button
          onClick={() => {
            setPage(1);
            load();
          }}
          className="px-3 py-2 rounded-md border border-gray-300 text-sm text-gray-700"
        >
          Search
        </button>
        <button
          onClick={exportCsv}
          disabled={logs.length === 0}
          className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm disabled:bg-gray-300"
        >
          Export Excel
        </button>
      </div>
      {loading ? (
        <div className="p-4 text-sm text-gray-500">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="p-4 text-sm text-gray-500">No delivery history yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-2 text-left">Campaign</th>
                <th className="px-4 py-2 text-left">Phone</th>
                <th className="px-4 py-2 text-left">Message</th>
                <th className="px-4 py-2 text-left">Status</th>
                <th className="px-4 py-2 text-left">Sent Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-700">{l.campaign_name ?? '—'}</td>
                  <td className="px-4 py-2 font-mono">{l.phone}</td>
                  <td className="px-4 py-2 text-gray-500 max-w-md truncate">{l.message}</td>
                  <td className="px-4 py-2">{badge(l.status)}</td>
                  <td className="px-4 py-2 text-gray-500">
                    {l.sent_at ? new Date(l.sent_at).toLocaleString() : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} total={total} limit={LIMIT} onPage={setPage} />
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/*  Reports                                                                   */
/* ========================================================================== */
function ReportsSection({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<api.ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api
      .getReports()
      .then(setData)
      .catch((e) => toast(`Failed to load reports: ${errMsg(e, '')}`, 'error'))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  if (loading || !data) {
    return <div className="bg-white rounded-lg shadow p-6 text-sm text-gray-500">Loading…</div>;
  }

  const cards: Array<{ label: string; value: number | string; icon: any; cls: string }> = [
    { label: 'Total Sent', value: data.totals.sent, icon: CheckCircle2, cls: 'text-green-600 bg-green-50' },
    { label: 'Total Failed', value: data.totals.failed, icon: XCircle, cls: 'text-red-600 bg-red-50' },
    { label: 'Sent Today', value: data.totals.today, icon: Send, cls: 'text-blue-600 bg-blue-50' },
    { label: 'Remaining Today', value: data.remaining_today, icon: BarChart3, cls: 'text-indigo-600 bg-indigo-50' },
    { label: 'Campaigns', value: data.campaigns, icon: MessageSquareText, cls: 'text-gray-700 bg-gray-100' },
    { label: 'Queue Pending', value: data.queue_pending, icon: ListChecks, cls: 'text-yellow-600 bg-yellow-50' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="bg-white rounded-lg shadow p-5 flex items-center gap-4">
            <div className={`p-3 rounded-lg ${c.cls}`}>
              <c.icon className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500">{c.label}</p>
              <p className="text-2xl font-semibold">{c.value}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-lg shadow p-5 text-sm text-gray-600">
        Daily limit: <strong>{data.daily_limit}</strong> · Gateway:{' '}
        {data.gateway_enabled ? (
          <span className="text-green-600 font-medium">Enabled</span>
        ) : (
          <span className="text-red-600 font-medium">Disabled</span>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  Root                                                                      */
/* ========================================================================== */
export function BulkSms() {
  const [sub, setSub] = useState('gateway');
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = () => setRefreshKey((k) => k + 1);

  return (
    <div className="space-y-4">
      <div className="rounded-md bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800">
        <strong>Marketing → Bulk SMS.</strong> A production phone-gateway (TextBee) pipeline for
        admin-controlled bulk campaigns — fully separate from the OTP SMS / Telegram system. Upload
        a phone list, pick or write a template, and send through a throttled background queue with
        automatic retries and daily limits.
      </div>

      <TabGroup tabs={SUB_TABS} activeTab={sub} onTabChange={setSub} />

      {sub === 'gateway' && <GatewaySettingsSection />}
      {sub === 'templates' && <TemplatesSection />}
      {sub === 'campaign' && (
        <CreateCampaignSection
          onCreated={() => {
            bump();
            setSub('queue');
          }}
        />
      )}
      {sub === 'queue' && <CampaignsQueueSection refreshKey={refreshKey} />}
      {sub === 'history' && <HistorySection refreshKey={refreshKey} />}
      {sub === 'reports' && <ReportsSection refreshKey={refreshKey} />}
    </div>
  );
}
