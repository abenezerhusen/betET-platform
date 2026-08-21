import React, { useEffect, useState } from 'react';
import {
  Gift,
  Zap,
  DollarSign,
  Shield,
  Save,
  RefreshCw,
  Target,
  Clock,
  Wallet,
  BarChart3,
  CalendarRange,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import * as promotionsApi from '../../lib/api/promotions';
import type {
  FirstDepositBonusConfig,
  FirstDepositBonusStats,
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
      <div className="p-2 bg-blue-50 rounded-lg">
        <Icon className="h-5 w-5 text-blue-600" />
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
        checked ? 'bg-blue-600' : 'bg-gray-300'
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
  step = 1,
  min = 0,
  suffix,
  hint,
  integer = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
  hint?: React.ReactNode;
  integer?: boolean;
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <div className="relative">
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Math.max(min, integer ? Math.floor(n) : n));
        }}
        className="block w-full rounded-lg border border-gray-300 px-3 py-2 pr-14 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
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

const StatBox = ({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: string;
}) => (
  <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
    <p className="text-[11px] uppercase tracking-wide text-gray-500">{label}</p>
    <p className={`text-lg font-bold ${accent ?? 'text-gray-900'}`}>{value}</p>
  </div>
);

/* ─────────────────────────── Main Page ─────────────────────────────── */

const DEFAULT_CONFIG: FirstDepositBonusConfig = {
  is_enabled: false,
  bonus_name: 'First Deposit Welcome',
  description: '',
  match_pct: 100,
  max_bonus: 500,
  min_deposit: 10,
  max_eligible_deposit: 500,
  wagering_multiplier: 5,
  qualifying_bet_type: 'accumulator',
  min_selections: 3,
  min_selection_odds: 1.4,
  expires_in_days: 7,
  max_claims_per_user: 1,
  start_date: null,
  end_date: null,
  daily_budget: 0,
  monthly_budget: 0,
  total_budget: 0,
  max_total_claims: 0,
  eligible_user_groups: [],
  existing_bonus_policy: 'continue',
};

export default function FirstDepositBonus() {
  const { isAuthenticated } = useAuthStore();
  const [config, setConfig] = useState<FirstDepositBonusConfig>(DEFAULT_CONFIG);
  const [stats, setStats] = useState<FirstDepositBonusStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    Promise.all([
      promotionsApi.getFirstDepositBonusConfig(),
      promotionsApi.getFirstDepositBonusStats().catch(() => null),
    ])
      .then(([cfg, st]) => {
        setConfig(cfg);
        setStats(st);
      })
      .catch((err: Error) => toast(`Failed to load config: ${err.message}`, 'error'))
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  const set = <K extends keyof FirstDepositBonusConfig>(
    key: K,
    value: FirstDepositBonusConfig[K]
  ) => setConfig((c) => ({ ...c, [key]: value }));

  const handleSave = () => {
    if (config.match_pct < 0 || config.max_bonus < 0 || config.min_deposit < 0) {
      toast('Values must be non-negative.', 'error');
      return;
    }
    if (config.is_enabled && config.match_pct <= 0) {
      toast('Set a match percentage greater than 0 to enable the bonus.', 'error');
      return;
    }
    setSaving(true);
    promotionsApi
      .updateFirstDepositBonusConfig(config)
      .then(() => toast('First Deposit bonus settings saved.'))
      .catch((err: Error) => toast(`Failed to save: ${err.message}`, 'error'))
      .finally(() => setSaving(false));
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500 text-sm">
        Loading First Deposit bonus settings…
      </div>
    );
  }

  // Example calculation for the preview (uses max_eligible_deposit as a sample).
  const sampleDeposit = config.max_eligible_deposit > 0 ? config.max_eligible_deposit : 100;
  const eligible =
    config.max_eligible_deposit > 0
      ? Math.min(sampleDeposit, config.max_eligible_deposit)
      : sampleDeposit;
  let sampleBonus = (eligible * config.match_pct) / 100;
  if (config.max_bonus > 0) sampleBonus = Math.min(sampleBonus, config.max_bonus);
  const sampleTurnover = sampleBonus * config.wagering_multiplier;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            First Deposit (Welcome) Bonus
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Reward a user's first qualifying deposit with a matched, non-withdrawable
            bonus that unlocks after a wagering requirement is met on qualifying
            accumulators. Every value here is configurable — nothing is hard-coded.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left column — config */}
        <div className="xl:col-span-2 space-y-6">
          {/* Program status */}
          <SectionCard
            icon={Zap}
            title="Program Status"
            subtitle="Enable or disable the First Deposit bonus globally"
          >
            <div className="space-y-4">
              <Toggle
                checked={config.is_enabled}
                onChange={(v) => set('is_enabled', v)}
                label={
                  config.is_enabled
                    ? 'First Deposit Bonus — Active'
                    : 'First Deposit Bonus — Disabled'
                }
                description={
                  config.is_enabled
                    ? 'Eligible users are credited a matched bonus on their first qualifying deposit.'
                    : 'When disabled, new deposits receive no welcome bonus — deposits behave exactly as before.'
                }
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bonus name
                </label>
                <input
                  type="text"
                  value={config.bonus_name}
                  onChange={(e) => set('bonus_name', e.target.value)}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description (shown to users)
                </label>
                <textarea
                  rows={2}
                  value={config.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="Get 100% extra on your first deposit, up to 500 ETB."
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
              </div>
            </div>
          </SectionCard>

          {/* Bonus calculation */}
          <SectionCard
            icon={DollarSign}
            title="Bonus Calculation"
            subtitle="Match percentage and deposit limits"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <NumberField
                label="Match percentage"
                value={config.match_pct}
                onChange={(v) => set('match_pct', v)}
                step={1}
                suffix="%"
                hint="Bonus = deposit × match %."
              />
              <NumberField
                label="Maximum bonus"
                value={config.max_bonus}
                onChange={(v) => set('max_bonus', v)}
                step={1}
                suffix="ETB"
                hint="Bonus never exceeds this. 0 = uncapped."
              />
              <NumberField
                label="Minimum deposit"
                value={config.min_deposit}
                onChange={(v) => set('min_deposit', v)}
                step={1}
                suffix="ETB"
                hint="Deposits below this don't qualify."
              />
              <NumberField
                label="Maximum eligible deposit"
                value={config.max_eligible_deposit}
                onChange={(v) => set('max_eligible_deposit', v)}
                step={1}
                suffix="ETB"
                hint="Deposit above this is not matched. 0 = no cap."
              />
            </div>
          </SectionCard>

          {/* Wagering & validity */}
          <SectionCard
            icon={Clock}
            title="Wagering & Validity"
            subtitle="Turnover requirement and expiry"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <NumberField
                label="Wagering multiplier (×)"
                value={config.wagering_multiplier}
                onChange={(v) => set('wagering_multiplier', v)}
                step={0.5}
                hint={
                  <>
                    Turnover required ={' '}
                    <strong>bonus × {config.wagering_multiplier || 0}</strong>.
                  </>
                }
              />
              <NumberField
                label="Expiry (days)"
                value={config.expires_in_days}
                onChange={(v) => set('expires_in_days', v)}
                step={1}
                integer
                hint="Bonus expires this many days after grant. 0 = never."
              />
            </div>
          </SectionCard>

          {/* Qualifying bets */}
          <SectionCard
            icon={Target}
            title="Qualifying Bets"
            subtitle="Which bets count toward the wagering requirement"
          >
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Qualifying bet type
                </label>
                <select
                  value={config.qualifying_bet_type}
                  onChange={(e) =>
                    set(
                      'qualifying_bet_type',
                      e.target.value as FirstDepositBonusConfig['qualifying_bet_type']
                    )
                  }
                  className="block w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="accumulator">Accumulator only</option>
                  <option value="any">Any bet</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <NumberField
                  label="Minimum selections (events)"
                  value={config.min_selections}
                  onChange={(v) => set('min_selections', v)}
                  step={1}
                  integer
                  hint="Accumulator must combine at least this many events."
                />
                <NumberField
                  label="Minimum odds per selection"
                  value={config.min_selection_odds}
                  onChange={(v) => set('min_selection_odds', v)}
                  step={0.01}
                  hint="Every selection must be priced at or above this."
                />
              </div>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
                Turnover is counted at <strong>settlement</strong> (won or lost, never
                void/cancelled). An accumulator only counts if <em>every</em> selection meets
                the minimum odds. Each ticket counts once.
              </div>
            </div>
          </SectionCard>

          {/* Limits & financial safety */}
          <SectionCard
            icon={Shield}
            title="Limits & Financial Safety"
            subtitle="Caps to control bonus liability (0 = unlimited)"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <NumberField
                label="Max claims per user"
                value={config.max_claims_per_user}
                onChange={(v) => set('max_claims_per_user', v)}
                step={1}
                integer
                hint="Usually 1 for a first-deposit welcome."
              />
              <NumberField
                label="Max total claims (all users)"
                value={config.max_total_claims}
                onChange={(v) => set('max_total_claims', v)}
                step={1}
                integer
                hint="Stop after this many grants. 0 = unlimited."
              />
              <NumberField
                label="Daily bonus budget"
                value={config.daily_budget}
                onChange={(v) => set('daily_budget', v)}
                step={100}
                suffix="ETB"
                hint="Stop granting once today's issued bonus reaches this."
              />
              <NumberField
                label="Monthly bonus budget"
                value={config.monthly_budget}
                onChange={(v) => set('monthly_budget', v)}
                step={1000}
                suffix="ETB"
                hint="Stop granting once this month's issued bonus reaches this."
              />
              <NumberField
                label="Total promotional budget"
                value={config.total_budget}
                onChange={(v) => set('total_budget', v)}
                step={1000}
                suffix="ETB"
                hint="Lifetime cap on issued bonus for this promo."
              />
            </div>
          </SectionCard>

          {/* Promotion window */}
          <SectionCard
            icon={CalendarRange}
            title="Promotion Window & Policy"
            subtitle="Optional start/end dates and existing-bonus behavior"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start date
                </label>
                <input
                  type="datetime-local"
                  value={toLocalInput(config.start_date)}
                  onChange={(e) => set('start_date', fromLocalInput(e.target.value))}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Empty = starts immediately.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End date
                </label>
                <input
                  type="datetime-local"
                  value={toLocalInput(config.end_date)}
                  onChange={(e) => set('end_date', fromLocalInput(e.target.value))}
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">Empty = open-ended.</p>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  When disabled, existing active bonuses…
                </label>
                <select
                  value={config.existing_bonus_policy}
                  onChange={(e) =>
                    set(
                      'existing_bonus_policy',
                      e.target.value as FirstDepositBonusConfig['existing_bonus_policy']
                    )
                  }
                  className="block w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="continue">Continue as normal (recommended)</option>
                  <option value="cancel">Lock / cancel (admin-driven)</option>
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Disabling the promo always stops new grants; existing bonuses are never
                  deleted.
                </p>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* Right column — preview + stats */}
        <div className="space-y-6">
          <SectionCard icon={Gift} title="Live Preview" subtitle="Example with current settings">
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-5 space-y-3">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
                {config.bonus_name || 'First Deposit Welcome'}
              </p>
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white rounded-full shadow-sm">
                  <Gift className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {config.match_pct}% up to {config.max_bonus.toFixed(0)} ETB
                  </p>
                  <p className="text-xs text-gray-500">Non-withdrawable until wagered</p>
                </div>
              </div>
              <div className="text-xs text-gray-600 space-y-1">
                <p>
                  Deposit {sampleDeposit.toFixed(0)} ETB → bonus{' '}
                  <strong>{sampleBonus.toFixed(2)} ETB</strong>
                </p>
                <p>
                  Turnover required: <strong>{sampleTurnover.toFixed(2)} ETB</strong>{' '}
                  ({config.wagering_multiplier}×)
                </p>
                <p>
                  Qualifying:{' '}
                  <strong>
                    {config.qualifying_bet_type === 'accumulator'
                      ? `${config.min_selections}+ selection accumulators`
                      : 'any bet'}
                  </strong>{' '}
                  @ {config.min_selection_odds.toFixed(2)}+ odds each
                </p>
                <p>
                  Expiry:{' '}
                  <strong>
                    {config.expires_in_days > 0 ? `${config.expires_in_days} days` : 'never'}
                  </strong>
                </p>
              </div>
              {!config.is_enabled && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-1.5">
                  Program is currently disabled — first deposits receive no welcome bonus.
                </p>
              )}
            </div>
          </SectionCard>

          <SectionCard icon={BarChart3} title="Promotion Stats" subtitle="Live totals for this bonus">
            {stats ? (
              <div className="grid grid-cols-2 gap-3">
                <StatBox label="Users Claimed" value={String(stats.total_claimed)} />
                <StatBox
                  label="Deposited (promo)"
                  value={`${stats.total_deposited.toFixed(0)} ETB`}
                />
                <StatBox
                  label="Bonus Issued"
                  value={`${stats.total_bonus_issued.toFixed(0)} ETB`}
                />
                <StatBox
                  label="Bonus Unlocked"
                  value={`${stats.total_bonus_unlocked.toFixed(0)} ETB`}
                  accent="text-emerald-600"
                />
                <StatBox
                  label="Bonus Expired"
                  value={`${stats.total_bonus_expired.toFixed(0)} ETB`}
                  accent="text-red-600"
                />
                <StatBox
                  label="Qualifying Turnover"
                  value={`${stats.total_qualifying_turnover.toFixed(0)} ETB`}
                />
                <StatBox label="Active" value={String(stats.active)} accent="text-blue-600" />
                <StatBox label="Completed" value={String(stats.completed)} accent="text-emerald-600" />
                <StatBox label="Expired" value={String(stats.expired)} accent="text-amber-600" />
                <StatBox label="Cancelled" value={String(stats.cancelled)} />
                <StatBox label="Issued Today" value={`${stats.issued_today.toFixed(0)} ETB`} />
                <StatBox label="Issued (Month)" value={`${stats.issued_month.toFixed(0)} ETB`} />
              </div>
            ) : (
              <p className="text-sm text-gray-500">No stats available yet.</p>
            )}
          </SectionCard>

          <SectionCard icon={Wallet} title="How It Works" subtitle="Server-side, transactional">
            <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
              <li>User makes their first qualifying online deposit.</li>
              <li>Server validates eligibility (first deposit, not previously claimed, budgets).</li>
              <li>Deposit is credited to cash; the bonus is credited to locked bonus balance.</li>
              <li>Turnover accrues on qualifying accumulators at settlement.</li>
              <li>When turnover is met, the bonus converts to withdrawable cash (once).</li>
              <li>If it expires first, the un-earned bonus is locked and marked EXPIRED (kept for audit).</li>
            </ol>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── Date helpers ─────────────────────────── */

function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
