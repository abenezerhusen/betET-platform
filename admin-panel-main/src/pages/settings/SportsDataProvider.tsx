import React, { useEffect, useState } from 'react';
import {
  Database,
  RefreshCw,
  Plug,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Activity,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import { useAuthStore } from '../../store/auth';
import * as api from '../../lib/api/sportsProvider';

const BOOKMAKERS = ['Bet365', '1xBet', 'Pinnacle', 'William Hill', 'Marathonbet'];

const fmt = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString() : '—';

const StatCard = ({
  icon: Icon,
  title,
  value,
  tone = 'green',
}: {
  icon: any;
  title: string;
  value: string;
  tone?: 'green' | 'blue' | 'amber' | 'red';
}) => {
  const toneMap: Record<string, string> = {
    green: 'bg-green-50 text-green-600',
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    red: 'bg-red-50 text-red-600',
  };
  return (
    <div className="bg-white p-5 rounded-lg shadow-sm">
      <div className="flex items-center space-x-3">
        <div className={`p-2 rounded-lg ${toneMap[tone]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-gray-500">{title}</p>
          <p className="text-lg font-semibold truncate">{value}</p>
        </div>
      </div>
    </div>
  );
};

export function SportsDataProvider() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [status, setStatus] = useState<api.ProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Editable form state
  const [enabled, setEnabled] = useState(false);
  const [apiUrl, setApiUrl] = useState('https://api.odds-api.io/v3');
  const [apiKey, setApiKey] = useState('');
  const [bookmaker, setBookmaker] = useState('Bet365');
  const [sports, setSports] = useState('football, basketball');
  const [leagues, setLeagues] = useState('');
  const [prematchInterval, setPrematchInterval] = useState(900);
  const [liveInterval, setLiveInterval] = useState(120);
  const [maxRequests, setMaxRequests] = useState(100);
  const [syncWindow, setSyncWindow] = useState(72);

  const hydrate = (s: api.ProviderStatus) => {
    setStatus(s);
    setEnabled(s.enabled);
    setApiUrl(s.api_url);
    setBookmaker(s.bookmaker || 'Bet365');
    setSports((s.sports ?? []).join(', '));
    setLeagues((s.leagues ?? []).join(', '));
    setPrematchInterval(s.prematch_interval_seconds);
    setLiveInterval(s.live_interval_seconds);
    setMaxRequests(s.max_requests_per_hour);
    setSyncWindow(s.sync_window_hours);
  };

  const load = async () => {
    setLoading(true);
    try {
      const s = await api.getStatus();
      hydrate(s);
    } catch {
      toast('Failed to load provider status', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAuth) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuth]);

  const parseList = (v: string) =>
    v
      .split(/[,\n]/)
      .map((x) => x.trim())
      .filter(Boolean);

  const save = async () => {
    setSaving(true);
    try {
      const sportsList = parseList(sports.toLowerCase());
      const leaguesList = parseList(leagues);
      const input: api.ProviderConfigInput = {
        enabled,
        api_url: apiUrl.trim(),
        bookmaker: bookmaker.trim(),
        sports: sportsList.length ? sportsList : undefined,
        leagues: leaguesList.length ? leaguesList : null,
        prematch_interval_seconds: prematchInterval,
        live_interval_seconds: liveInterval,
        max_requests_per_hour: maxRequests,
        sync_window_hours: syncWindow,
      };
      if (apiKey.trim().length > 0) input.api_key = apiKey.trim();
      const s = await api.saveConfig(input);
      hydrate(s);
      setApiKey('');
      toast('Provider settings saved');
    } catch {
      toast('Failed to save settings', 'error');
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const r = await api.testConnection();
      if (r.ok) {
        toast(`Connection OK — ${r.sports} sports available`);
      } else {
        toast(`Connection failed: ${r.error ?? 'unknown error'}`, 'error');
      }
    } catch {
      toast('Connection test failed', 'error');
    } finally {
      setTesting(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api.syncNow();
      hydrate(r.status);
      toast(
        `Sync done — ${r.events_upserted} events, ${r.odds_upserted} odds, ` +
          `${r.results_finalized ?? 0} results, ${r.tickets_settled ?? 0} tickets settled`
      );
    } catch {
      toast('Manual sync failed', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const statusTone: 'green' | 'amber' | 'red' | 'blue' =
    status?.status === 'ok'
      ? 'green'
      : status?.status === 'error'
        ? 'red'
        : status?.status === 'syncing'
          ? 'blue'
          : 'amber';

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Database className="h-6 w-6 text-green-600" />
            Sports Data Provider
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Real odds &amp; match data (Odds-API.io) that feeds the existing
            sportsbook. Betting, wallets and design are untouched.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={test}
            disabled={testing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            <Plug size={16} />
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
          <button
            onClick={sync}
            disabled={syncing}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
          >
            <RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
            {syncing ? 'Syncing…' : 'Sync Now'}
          </button>
        </div>
      </div>

      {/* Mode banner */}
      {status && status.data_provider_mode === 'mock' && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            The platform master switch <code>DATA_PROVIDER</code> is currently{' '}
            <strong>mock</strong>. You can configure and manually sync here, but
            the automatic background sync stays dormant until{' '}
            <code>DATA_PROVIDER=odds_api</code> is set in the backend
            environment. Existing mock data keeps working unchanged.
          </div>
        </div>
      )}

      {/* Runtime status cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Activity}
          title="Status"
          value={status ? status.status : '—'}
          tone={statusTone}
        />
        <StatCard
          icon={CheckCircle2}
          title="Events Synced"
          value={status ? String(status.events_synced) : '0'}
          tone="blue"
        />
        <StatCard
          icon={CheckCircle2}
          title="Odds Synced"
          value={status ? String(status.odds_synced) : '0'}
          tone="green"
        />
        <StatCard
          icon={Clock}
          title="Last Success"
          value={fmt(status?.last_success_at ?? null)}
          tone="amber"
        />
      </div>

      {status?.last_error && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">Last sync error</p>
            <p className="break-words">{status.last_error}</p>
          </div>
        </div>
      )}

      {/* Pipeline health — provider → events → odds → results → settlement */}
      {status?.stats && (
        <div className="bg-white rounded-lg shadow-sm p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold">Sync &amp; Settlement Pipeline</h2>
            <p className="text-sm text-gray-500">
              Live counts across the whole chain so a stuck stage is visible
              immediately. “Awaiting results” are past-kickoff matches without a
              final result yet; tickets flagged for review appear under Manual
              Settlement → Errors.
            </p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            <StatCard
              icon={Database}
              title="Leagues"
              value={String(status.stats.leagues_total ?? 0)}
              tone="blue"
            />
            <StatCard
              icon={CheckCircle2}
              title="Events with Odds"
              value={String(status.stats.events_with_odds ?? 0)}
              tone="green"
            />
            <StatCard
              icon={Activity}
              title="Live Events"
              value={String(status.stats.events_live ?? 0)}
              tone="blue"
            />
            <StatCard
              icon={CheckCircle2}
              title="Completed Events"
              value={String(status.stats.events_completed ?? 0)}
              tone="green"
            />
            <StatCard
              icon={Clock}
              title="Awaiting Results"
              value={String(status.stats.events_awaiting_results ?? 0)}
              tone={(status.stats.events_awaiting_results ?? 0) > 0 ? 'amber' : 'green'}
            />
            <StatCard
              icon={Clock}
              title="Unsettled Tickets"
              value={String(status.stats.unsettled_tickets ?? 0)}
              tone={(status.stats.unsettled_tickets ?? 0) > 0 ? 'amber' : 'green'}
            />
            <StatCard
              icon={AlertTriangle}
              title="Tickets Needing Review"
              value={String(status.stats.tickets_needing_review ?? 0)}
              tone={(status.stats.tickets_needing_review ?? 0) > 0 ? 'red' : 'green'}
            />
            <StatCard
              icon={CheckCircle2}
              title="Tickets Auto-Settled"
              value={String(status.tickets_settled ?? 0)}
              tone="green"
            />
          </div>
          <p className="text-xs text-gray-400">
            Last result sync: {fmt(status.last_results_sync_at)} · Last
            settlement: {fmt(status.stats.last_settlement_at ?? null)} · Results
            finalized (total): {status.results_finalized ?? 0}
          </p>
        </div>
      )}

      {/* Configuration form */}
      <div className="bg-white rounded-lg shadow-sm p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Provider Configuration</h2>
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="text-sm font-medium">
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API URL
                </label>
                <input
                  type="text"
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                  placeholder="https://api.odds-api.io/v3"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="new-password"
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                  placeholder={
                    status?.has_api_key
                      ? `${status.api_key_masked ?? '••••'} (${status.api_key_source}) — leave blank to keep`
                      : 'Enter Odds-API.io key'
                  }
                />
                <p className="text-xs text-gray-400 mt-1">
                  Stored sealed (AES-256-GCM). An admin key overrides the env
                  key. Never displayed after saving.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bookmaker (odds source)
                </label>
                <input
                  list="bookmaker-options"
                  value={bookmaker}
                  onChange={(e) => setBookmaker(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                />
                <datalist id="bookmaker-options">
                  {BOOKMAKERS.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sports (comma-separated slugs)
                </label>
                <input
                  type="text"
                  value={sports}
                  onChange={(e) => setSports(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                  placeholder="football, basketball"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Leagues allow-list (optional — blank = all leagues)
                </label>
                <input
                  type="text"
                  value={leagues}
                  onChange={(e) => setLeagues(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                  placeholder="England - Premier League, Spain - La Liga"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-5 pt-2 border-t border-gray-100">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Prematch interval (sec)
                </label>
                <input
                  type="number"
                  min={60}
                  value={prematchInterval}
                  onChange={(e) => setPrematchInterval(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Live interval (sec)
                </label>
                <input
                  type="number"
                  min={30}
                  value={liveInterval}
                  onChange={(e) => setLiveInterval(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Max requests / hour
                </label>
                <input
                  type="number"
                  min={1}
                  value={maxRequests}
                  onChange={(e) => setMaxRequests(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Raise this after upgrading your plan.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Sync window (hours)
                </label>
                <input
                  type="number"
                  min={1}
                  value={syncWindow}
                  onChange={(e) => setSyncWindow(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:ring-green-500"
                />
              </div>
            </div>

            <div className="flex items-center justify-between pt-2">
              <p className="text-xs text-gray-400">
                Last run: {fmt(status?.last_run_at ?? null)} · Updated:{' '}
                {fmt(status?.updated_at ?? null)}
              </p>
              <button
                onClick={save}
                disabled={saving}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save Settings'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
