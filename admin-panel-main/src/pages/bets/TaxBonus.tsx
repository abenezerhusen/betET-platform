import React, { useEffect, useMemo, useState } from 'react';
import {
  Percent,
  Gift,
  Landmark,
  Save,
  RefreshCw,
  Calculator,
  BarChart3,
  Filter,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import * as sportsbookApi from '../../lib/api/sportsbook';
import type {
  SportsbookTaxConfig,
  SportsbookTaxReport,
} from '../../lib/api/sportsbook';
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
      <div className="p-2 bg-emerald-50 rounded-lg">
        <Icon className="h-5 w-5 text-emerald-600" />
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
        checked ? 'bg-emerald-600' : 'bg-gray-300'
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
  disabled,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  step?: number;
  min?: number;
  suffix?: string;
  disabled?: boolean;
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <div className="relative">
      <input
        type="number"
        min={min}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-emerald-500 focus:ring-emerald-500 disabled:bg-gray-100 disabled:text-gray-400"
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

const round2 = (n: number) => Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
const money = (n: number) =>
  n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ─────────────────────────── Main Page ─────────────────────────────── */

export default function TaxBonus() {
  const { isAuthenticated } = useAuthStore();
  const [cfg, setCfg] = useState<SportsbookTaxConfig>(
    sportsbookApi.DEFAULT_SPORTSBOOK_TAX
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Worked-example inputs for the live preview.
  const [sampleStake, setSampleStake] = useState(100);
  const [sampleOdds, setSampleOdds] = useState(2.5);

  // Report state.
  const [report, setReport] = useState<SportsbookTaxReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [sport, setSport] = useState('');
  const [league, setLeague] = useState('');

  useEffect(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    sportsbookApi
      .getSportsbookTaxConfig()
      .then((c) => setCfg(c))
      .catch((err: Error) => toast(`Failed to load tax config: ${err.message}`, 'error'))
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  const patch = (p: Partial<SportsbookTaxConfig>) => setCfg((c) => ({ ...c, ...p }));

  const handleSave = () => {
    setSaving(true);
    sportsbookApi
      .updateSportsbookTaxConfig(cfg)
      .then((saved) => {
        setCfg(saved);
        toast('Sportsbook tax & bonus settings saved. Applies to new tickets immediately.');
      })
      .catch((err: Error) => toast(`Failed to save: ${err.message}`, 'error'))
      .finally(() => setSaving(false));
  };

  const loadReport = () => {
    setReportLoading(true);
    sportsbookApi
      .getSportsbookTaxReport({
        from: from || undefined,
        to: to || undefined,
        sport: sport || undefined,
        league: league || undefined,
      })
      .then((r) => setReport(r))
      .catch((err: Error) => toast(`Failed to load report: ${err.message}`, 'error'))
      .finally(() => setReportLoading(false));
  };

  // Live worked example following the exact spec calculation order.
  const preview = useMemo(() => {
    const stake = round2(sampleStake);
    const betTax = cfg.betting_tax_enabled
      ? round2(stake * (cfg.betting_tax_percent / 100))
      : 0;
    const effStake = round2(stake - betTax);
    const gross = round2(effStake * sampleOdds);
    const bonus = cfg.compensation_bonus_enabled
      ? round2(gross * (cfg.compensation_bonus_percent / 100))
      : 0;
    const subtotal = round2(gross + bonus);
    const winTax =
      cfg.winning_tax_enabled && subtotal > cfg.winning_tax_threshold
        ? round2(subtotal * (cfg.winning_tax_percent / 100))
        : 0;
    const final = round2(subtotal - winTax);
    return { stake, betTax, effStake, gross, bonus, subtotal, winTax, final };
  }, [sampleStake, sampleOdds, cfg]);

  const reportRows: Array<{ label: string; value: string; strong?: boolean }> = report
    ? [
        { label: 'Total tickets', value: report.total_tickets.toLocaleString() },
        { label: 'Total original stakes', value: money(report.total_original_stakes) },
        {
          label: 'Total betting tax collected',
          value: money(report.total_betting_tax_collected),
        },
        { label: 'Total effective stakes', value: money(report.total_effective_stakes) },
        {
          label: 'Total compensation bonus paid',
          value: money(report.total_compensation_bonus_paid),
        },
        {
          label: 'Total winning tax collected',
          value: money(report.total_winning_tax_collected),
        },
        { label: 'Total final payout', value: money(report.total_final_payout) },
        {
          label: 'Net sportsbook revenue',
          value: money(report.net_sportsbook_revenue),
          strong: true,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Sportsbook Tax &amp; Bonus Management
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Configure the mandatory betting tax, optional compensation bonus and winning
            tax. All maths runs on the backend — customers always see their full stake and
            odds. Applies to <strong>sportsbook tickets only</strong>.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-60 transition-colors"
        >
          {saving ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      {loading ? (
        <div className="p-8 text-center text-gray-500 text-sm">Loading tax settings…</div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Left — settings */}
          <div className="xl:col-span-2 space-y-6">
            <SectionCard
              icon={Percent}
              title="1. Betting Tax (mandatory)"
              subtitle="Deducted internally from the stake to form the effective stake"
            >
              <div className="space-y-5">
                <Toggle
                  checked={cfg.betting_tax_enabled}
                  onChange={(v) => patch({ betting_tax_enabled: v })}
                  label={cfg.betting_tax_enabled ? 'Betting Tax — Enabled' : 'Betting Tax — Disabled'}
                  description="Reduces the payout stake; the customer still pays and sees the full stake."
                />
                <NumberField
                  label="Tax percentage"
                  value={cfg.betting_tax_percent}
                  onChange={(v) => patch({ betting_tax_percent: Math.max(0, Math.min(100, v)) })}
                  step={0.5}
                  suffix="%"
                  disabled={!cfg.betting_tax_enabled}
                  hint="Example: 15% → a 100 stake produces an 85 effective stake."
                />
              </div>
            </SectionCard>

            <SectionCard
              icon={Gift}
              title="2. Compensation Bonus (optional)"
              subtitle="Adds a percentage on top of gross winnings"
            >
              <div className="space-y-5">
                <Toggle
                  checked={cfg.compensation_bonus_enabled}
                  onChange={(v) => patch({ compensation_bonus_enabled: v })}
                  label={
                    cfg.compensation_bonus_enabled
                      ? 'Compensation Bonus — Enabled'
                      : 'Compensation Bonus — Disabled'
                  }
                  description="Compensates customers for the betting tax by boosting winnings."
                />
                <NumberField
                  label="Bonus percentage"
                  value={cfg.compensation_bonus_percent}
                  onChange={(v) =>
                    patch({ compensation_bonus_percent: Math.max(0, Math.min(100, v)) })
                  }
                  step={0.5}
                  suffix="%"
                  disabled={!cfg.compensation_bonus_enabled}
                  hint="Applied to the gross win before the winning tax."
                />
              </div>
            </SectionCard>

            <SectionCard
              icon={Landmark}
              title="3. Winning Tax"
              subtitle="Deducted from the (gross + bonus) subtotal above a threshold"
            >
              <div className="space-y-5">
                <Toggle
                  checked={cfg.winning_tax_enabled}
                  onChange={(v) => patch({ winning_tax_enabled: v })}
                  label={cfg.winning_tax_enabled ? 'Winning Tax — Enabled' : 'Winning Tax — Disabled'}
                  description="Only tickets whose payout exceeds the threshold are taxed."
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                  <NumberField
                    label="Tax percentage"
                    value={cfg.winning_tax_percent}
                    onChange={(v) => patch({ winning_tax_percent: Math.max(0, Math.min(100, v)) })}
                    step={0.5}
                    suffix="%"
                    disabled={!cfg.winning_tax_enabled}
                  />
                  <NumberField
                    label="Minimum winning threshold"
                    value={cfg.winning_tax_threshold}
                    onChange={(v) => patch({ winning_tax_threshold: Math.max(0, v) })}
                    step={50}
                    suffix="ETB"
                    disabled={!cfg.winning_tax_enabled}
                    hint="Payouts at or below this amount are not taxed."
                  />
                </div>
              </div>
            </SectionCard>

            {/* Report */}
            <SectionCard
              icon={BarChart3}
              title="Sportsbook Tax Report"
              subtitle="Aggregated tax, bonus and revenue figures"
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">From</label>
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">To</label>
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Sport</label>
                  <input
                    type="text"
                    placeholder="e.g. Soccer"
                    value={sport}
                    onChange={(e) => setSport(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">League</label>
                  <input
                    type="text"
                    placeholder="e.g. La Liga"
                    value={league}
                    onChange={(e) => setLeague(e.target.value)}
                    className="block w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <button
                onClick={loadReport}
                disabled={reportLoading}
                className="inline-flex items-center gap-2 px-4 py-2 bg-gray-800 text-white text-sm font-medium rounded-lg hover:bg-gray-900 disabled:opacity-60 transition-colors mb-4"
              >
                {reportLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <Filter className="h-4 w-4" />
                )}
                {reportLoading ? 'Loading…' : 'Run Report'}
              </button>

              {report ? (
                <div className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
                  {reportRows.map((row) => (
                    <div
                      key={row.label}
                      className={`flex items-center justify-between px-4 py-2.5 text-sm ${
                        row.strong ? 'bg-emerald-50 font-semibold text-emerald-800' : ''
                      }`}
                    >
                      <span className={row.strong ? '' : 'text-gray-600'}>{row.label}</span>
                      <span className="tabular-nums">{row.value}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500">
                  Choose filters and run the report to see collected tax, bonuses and net
                  revenue.
                </p>
              )}
            </SectionCard>
          </div>

          {/* Right — live preview */}
          <div className="space-y-6">
            <SectionCard
              icon={Calculator}
              title="Live Calculation"
              subtitle="Worked example (backend uses the same order)"
            >
              <div className="grid grid-cols-2 gap-3 mb-4">
                <NumberField
                  label="Sample stake"
                  value={sampleStake}
                  onChange={(v) => setSampleStake(Math.max(0, v))}
                  step={10}
                  suffix="ETB"
                />
                <NumberField
                  label="Total odds"
                  value={sampleOdds}
                  onChange={(v) => setSampleOdds(Math.max(1, v))}
                  step={0.1}
                />
              </div>

              <div className="bg-gradient-to-br from-emerald-50 to-teal-50 rounded-lg border border-emerald-200 p-4 space-y-2 text-sm">
                <Row label="Customer stake" value={`${money(preview.stake)} ETB`} />
                <Row
                  label={`Betting tax (${cfg.betting_tax_enabled ? cfg.betting_tax_percent : 0}%)`}
                  value={`− ${money(preview.betTax)} ETB`}
                  muted
                />
                <Row label="Effective stake" value={`${money(preview.effStake)} ETB`} />
                <div className="border-t border-emerald-200 my-1" />
                <Row label={`Gross win (× ${sampleOdds})`} value={`${money(preview.gross)} ETB`} />
                <Row
                  label={`Compensation bonus (${
                    cfg.compensation_bonus_enabled ? cfg.compensation_bonus_percent : 0
                  }%)`}
                  value={`+ ${money(preview.bonus)} ETB`}
                  muted
                />
                <Row label="Subtotal" value={`${money(preview.subtotal)} ETB`} />
                <Row
                  label={`Winning tax (${
                    cfg.winning_tax_enabled && preview.subtotal > cfg.winning_tax_threshold
                      ? cfg.winning_tax_percent
                      : 0
                  }%)`}
                  value={`− ${money(preview.winTax)} ETB`}
                  muted
                />
                <div className="border-t border-emerald-300 my-1" />
                <Row
                  label="Final wallet credit"
                  value={`${money(preview.final)} ETB`}
                  strong
                />
              </div>

              <p className="text-xs text-gray-500 mt-4">
                The customer's ticket displays only <strong>{money(preview.stake)} ETB</strong>{' '}
                stake at <strong>{sampleOdds}</strong> odds. The tax breakdown is internal.
              </p>
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}

const Row = ({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) => (
  <div className="flex items-center justify-between">
    <span
      className={
        strong
          ? 'font-semibold text-emerald-800'
          : muted
          ? 'text-gray-500'
          : 'text-gray-700'
      }
    >
      {label}
    </span>
    <span className={`tabular-nums ${strong ? 'font-bold text-emerald-800' : 'text-gray-900'}`}>
      {value}
    </span>
  </div>
);
