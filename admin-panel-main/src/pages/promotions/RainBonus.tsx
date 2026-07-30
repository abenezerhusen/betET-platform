import React, { useEffect, useState } from 'react';
import {
  CloudRain,
  Zap,
  DollarSign,
  Users,
  Clock,
  Shield,
  Save,
  RefreshCw,
  Timer,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import * as promotionsApi from '../../lib/api/promotions';
import type {
  RainConfig,
  RainGameId,
  KenoCountdownConfig,
} from '../../lib/api/promotions';
import { useAuthStore } from '../../store/auth';

/* ─────────────────────────── Sub-components ─────────────────────────── */

const SectionCard = ({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
    <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
      <div className="p-2 bg-sky-50 rounded-lg">
        <Icon className="h-5 w-5 text-sky-600" />
      </div>
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
    </div>
    <div className="px-6 py-5">{children}</div>
  </div>
);

const Toggle = ({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      <p className="text-sm font-medium text-gray-900">{label}</p>
      {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
    </div>
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-sky-600' : 'bg-gray-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
      />
    </button>
  </div>
);

const NumberField = ({
  label,
  value,
  onChange,
  hint,
  step = 1,
  min = 0,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  step?: number;
  min?: number;
  suffix?: string;
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <div className="relative">
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:ring-sky-500"
      />
      {suffix && (
        <span className="absolute right-3 top-2.5 text-sm text-gray-500 pointer-events-none">
          {suffix}
        </span>
      )}
    </div>
    {hint && <p className="text-xs text-gray-500 mt-1">{hint}</p>}
  </div>
);

const GAME_LABELS: Record<RainGameId, string> = {
  'fast-keno': 'Fast Keno',
  aviator: 'Aviator',
};

/* ─────────────────────────── Main Page ─────────────────────────────── */

export default function RainBonus() {
  const { isAuthenticated } = useAuthStore();
  const [game, setGame] = useState<RainGameId>('fast-keno');
  const [config, setConfig] = useState<RainConfig>(promotionsApi.DEFAULT_RAIN_CONFIG);
  const [countdown, setCountdown] = useState<KenoCountdownConfig>({ betting_seconds: 30 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingCountdown, setSavingCountdown] = useState(false);

  // Load rain config whenever the selected game changes.
  useEffect(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    promotionsApi
      .getRainConfig(game)
      .then((cfg) => setConfig(cfg))
      .catch((err: Error) => toast(`Failed to load rain config: ${err.message}`, 'error'))
      .finally(() => setLoading(false));
  }, [isAuthenticated, game]);

  // Load the Fast Keno countdown once.
  useEffect(() => {
    if (!isAuthenticated) return;
    promotionsApi
      .getKenoCountdown()
      .then((c) => setCountdown(c))
      .catch(() => {});
  }, [isAuthenticated]);

  const patch = (p: Partial<RainConfig>) => setConfig((c) => ({ ...c, ...p }));

  const handleSave = () => {
    if (config.is_enabled && config.pool_amount <= 0 && config.per_claim_amount <= 0) {
      toast('Set a pool amount or per-claim amount before enabling rain.', 'error');
      return;
    }
    setSaving(true);
    promotionsApi
      .updateRainConfig(game, config)
      .then(() => toast(`${GAME_LABELS[game]} rain settings saved.`))
      .catch((err: Error) => toast(`Failed to save: ${err.message}`, 'error'))
      .finally(() => setSaving(false));
  };

  const handleSaveCountdown = () => {
    setSavingCountdown(true);
    promotionsApi
      .updateKenoCountdown(countdown)
      .then(() => toast('Fast Keno countdown saved.'))
      .catch((err: Error) => toast(`Failed to save: ${err.message}`, 'error'))
      .finally(() => setSavingCountdown(false));
  };

  const perClaimPreview =
    config.per_claim_amount > 0
      ? config.per_claim_amount
      : config.max_claims > 0
      ? config.pool_amount / config.max_claims
      : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Rain Bonus</h1>
          <p className="text-sm text-gray-500 mt-1">
            Schedule promotional "rain" drops for Fast Keno & Aviator. Eligible online players get a
            short window to <strong>claim</strong> free cash, credited instantly to their wallet.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-sky-600 text-white text-sm font-medium rounded-lg hover:bg-sky-700 disabled:opacity-60 transition-colors"
        >
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : `Save ${GAME_LABELS[game]} Rain`}
        </button>
      </div>

      {/* Game selector */}
      <div className="flex gap-2">
        {(Object.keys(GAME_LABELS) as RainGameId[]).map((g) => (
          <button
            key={g}
            onClick={() => setGame(g)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
              game === g
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {GAME_LABELS[g]}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-500 text-sm">Loading rain settings…</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left — config */}
          <div className="xl:col-span-2 space-y-6">
            <SectionCard
              icon={Zap}
              title="Program Status"
              subtitle={`Enable or disable rain for ${GAME_LABELS[game]}`}
            >
              <Toggle
                checked={config.is_enabled}
                onChange={(v) => patch({ is_enabled: v })}
                label={config.is_enabled ? 'Rain — Active' : 'Rain — Disabled'}
                description={
                  config.is_enabled
                    ? 'Rain events fire automatically on the schedule below; a claim button appears in-game.'
                    : 'No rain events will be scheduled for this game.'
                }
              />
            </SectionCard>

            <SectionCard
              icon={DollarSign}
              title="Pool & Distribution"
              subtitle="How much is dropped and how it's split"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <NumberField
                  label="Pool amount per rain"
                  value={config.pool_amount}
                  onChange={(v) => patch({ pool_amount: Math.max(0, v) })}
                  step={0.01}
                  suffix={config.currency}
                  hint="Total cash distributed in one rain event."
                />
                <NumberField
                  label="Fixed amount per claim"
                  value={config.per_claim_amount}
                  onChange={(v) => patch({ per_claim_amount: Math.max(0, v) })}
                  step={0.01}
                  suffix={config.currency}
                  hint="0 = split pool evenly across max claims."
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Distribution
                  </label>
                  <select
                    value={config.distribution}
                    onChange={(e) =>
                      patch({ distribution: e.target.value as RainConfig['distribution'] })
                    }
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:ring-sky-500"
                  >
                    <option value="equal">Equal — everyone gets the same</option>
                    <option value="random">Random — random share of the pool</option>
                  </select>
                </div>
                <NumberField
                  label="Max claims per rain"
                  value={config.max_claims}
                  onChange={(v) => patch({ max_claims: Math.max(1, Math.floor(v)) })}
                  hint="Number of players that can claim before it's depleted."
                />
              </div>
            </SectionCard>

            <SectionCard
              icon={Clock}
              title="Schedule"
              subtitle="When and how often rains fire (UTC)"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <NumberField
                  label="Rains per day"
                  value={config.rains_per_day}
                  onChange={(v) => patch({ rains_per_day: Math.max(1, Math.floor(v)) })}
                  hint="Spread evenly across the daily window."
                />
                <NumberField
                  label="Claim window (seconds)"
                  value={config.claim_deadline_seconds}
                  onChange={(v) => patch({ claim_deadline_seconds: Math.max(10, Math.floor(v)) })}
                  hint="How long players have to claim each rain."
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Window start (UTC HH:MM)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 18:00 (blank = all day)"
                    value={config.window_start}
                    onChange={(e) => patch({ window_start: e.target.value })}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:ring-sky-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Window end (UTC HH:MM)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. 22:00 (blank = all day)"
                    value={config.window_end}
                    onChange={(e) => patch({ window_end: e.target.value })}
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:ring-sky-500"
                  />
                </div>
              </div>
            </SectionCard>

            <SectionCard
              icon={Users}
              title="Eligibility"
              subtitle="Who can claim (0 disables a check)"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <NumberField
                  label="Minimum balance"
                  value={config.min_balance}
                  onChange={(v) => patch({ min_balance: Math.max(0, v) })}
                  step={0.01}
                  suffix={config.currency}
                  hint="Player must hold at least this cash balance."
                />
                <NumberField
                  label="Minimum wagered today"
                  value={config.min_wager_today}
                  onChange={(v) => patch({ min_wager_today: Math.max(0, v) })}
                  step={0.01}
                  suffix={config.currency}
                  hint="Total stakes placed since UTC midnight."
                />
                <NumberField
                  label="Minimum account age (days)"
                  value={config.min_account_age_days}
                  onChange={(v) => patch({ min_account_age_days: Math.max(0, Math.floor(v)) })}
                  hint="Account must be at least this old."
                />
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Credit destination
                  </label>
                  <select
                    value={config.credit_target}
                    onChange={(e) =>
                      patch({ credit_target: e.target.value as RainConfig['credit_target'] })
                    }
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-sky-500 focus:ring-sky-500"
                  >
                    <option value="bonus">Bonus balance (non-withdrawable, needs wagering)</option>
                    <option value="main">Main balance (withdrawable immediately)</option>
                  </select>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-4">
                Being online and claiming already proves the player is logged in and active — the
                "last login" rule is enforced implicitly. Suspended/banned accounts can never claim.
              </p>
            </SectionCard>

            <SectionCard icon={Shield} title="How It Works" subtitle="Server-side rules">
              <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
                <li>The scheduler fires a rain on time; a claim popup appears in {GAME_LABELS[game]}.</li>
                <li>Eligible online players tap <strong>Claim</strong> within the claim window.</li>
                <li>Each player is credited their share (first-come until the pool/slots run out).</li>
                <li>The reward lands in the configured wallet and a ledger entry is recorded.</li>
                <li>A player can only claim a given rain once (idempotent, anti-double-claim).</li>
              </ol>
            </SectionCard>
          </div>

          {/* Right — preview + countdown */}
          <div className="space-y-6">
            <SectionCard icon={CloudRain} title="Live Preview" subtitle="What players will see">
              <div className="bg-gradient-to-br from-sky-50 to-indigo-50 rounded-lg border border-sky-200 p-5 space-y-3">
                <p className="text-xs font-semibold text-sky-600 uppercase tracking-wide">
                  🌧️ Rain Bonus — {GAME_LABELS[game]}
                </p>
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-white rounded-full shadow-sm">
                    <CloudRain className="h-6 w-6 text-sky-600" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-gray-900">
                      ~{perClaimPreview.toFixed(2)} {config.currency}
                    </p>
                    <p className="text-xs text-gray-500">
                      {config.distribution === 'equal' ? 'per claim' : 'random per claim'}
                    </p>
                  </div>
                </div>
                {!config.is_enabled && (
                  <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-1.5">
                    Rain is disabled for this game.
                  </p>
                )}
              </div>
              {config.is_enabled && (
                <div className="mt-4 space-y-1 text-xs text-gray-600">
                  <p>
                    Pool <strong>{config.pool_amount.toFixed(2)} {config.currency}</strong> · up to{' '}
                    <strong>{config.max_claims}</strong> claimers
                  </p>
                  <p>
                    <strong>{config.rains_per_day}</strong> rains/day ·{' '}
                    {config.window_start && config.window_end
                      ? `${config.window_start}–${config.window_end} UTC`
                      : 'all day'}
                  </p>
                  <p>
                    Credited to{' '}
                    <strong>
                      {config.credit_target === 'main' ? 'main (withdrawable)' : 'bonus'}
                    </strong>{' '}
                    balance
                  </p>
                </div>
              )}
            </SectionCard>

            {/* Fast Keno countdown — keno-only setting */}
            <SectionCard
              icon={Timer}
              title="Fast Keno Countdown"
              subtitle="Betting timer per round (Fast Keno only)"
            >
              <NumberField
                label="Betting countdown (seconds)"
                value={countdown.betting_seconds}
                onChange={(v) =>
                  setCountdown({ betting_seconds: Math.max(5, Math.min(300, Math.floor(v))) })
                }
                min={5}
                hint="Default 30s. Applies to the next round after saving."
              />
              <button
                onClick={handleSaveCountdown}
                disabled={savingCountdown}
                className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-900 disabled:opacity-60 transition-colors"
              >
                {savingCountdown ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {savingCountdown ? 'Saving…' : 'Save Countdown'}
              </button>
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}
