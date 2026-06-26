import React, { useEffect, useState } from 'react';
import {
  Zap,
  Settings,
  TrendingUp,
  DollarSign,
  Shield,
  Eye,
  CheckSquare,
  Save,
  RefreshCw,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import * as promotionsApi from '../../lib/api/promotions';
import type { CashoutBoostConfig } from '../../lib/api/promotions';
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

const CheckboxRow = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) => (
  <label className="flex items-center gap-3 cursor-pointer group">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
    />
    <span className="text-sm text-gray-700 group-hover:text-gray-900">{label}</span>
  </label>
);

/* ────────────────────────── Preview Component ─────────────────────────── */

const BoostPreview = ({ config }: { config: CashoutBoostConfig }) => {
  const baseAmount = 420;
  const boostAmt =
    config.promotion_type === 'percentage'
      ? Math.round(baseAmount * (config.promotion_value / 100) * 100) / 100
      : config.promotion_value;
  const finalAmt = baseAmount + boostAmt;

  return (
    <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-5 space-y-3">
      <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">Live Preview</p>

      {config.display.show_badge && (
        <div className="inline-flex items-center gap-1.5 bg-orange-100 text-orange-700 text-xs font-bold px-3 py-1 rounded-full">
          {config.display.badge_text || '🔥 Cash Out Boost'}
        </div>
      )}

      <div className="space-y-2 text-sm">
        {config.display.show_original_amount && (
          <div className="flex justify-between text-gray-600">
            <span>Original Offer:</span>
            <span className="font-medium">{baseAmount} ETB</span>
          </div>
        )}
        {config.display.show_promotion_amount && (
          <div className="flex justify-between text-green-700">
            <span>
              Boost (
              {config.promotion_type === 'percentage'
                ? `+${config.promotion_value}%`
                : `+${config.promotion_value} ETB`}
              ):
            </span>
            <span className="font-medium">+{boostAmt.toFixed(2)} ETB</span>
          </div>
        )}
        {config.display.show_final_amount && (
          <div className="flex justify-between text-blue-700 font-semibold border-t border-blue-200 pt-2">
            <span>Final Offer:</span>
            <span>{finalAmt.toFixed(2)} ETB</span>
          </div>
        )}
      </div>

      {!config.is_enabled && (
        <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-1.5">
          Promotion is currently disabled — users see only the standard cashout offer.
        </p>
      )}
    </div>
  );
};

/* ─────────────────────────── Main Page ─────────────────────────────── */

export default function CashoutPromotion() {
  const { isAuthenticated } = useAuthStore();
  const [config, setConfig] = useState<CashoutBoostConfig>({
    is_enabled: false,
    promotion_type: 'percentage',
    promotion_value: 10,
    availability: {
      live_bets: true,
      prematch_bets: true,
      single_bets: true,
      multiple_bets: true,
      system_bets: false,
    },
    sports: {
      football: true,
      basketball: true,
      tennis: true,
      volleyball: true,
      esports: false,
      virtual: false,
      others: true,
    },
    display: {
      show_badge: true,
      show_original_amount: true,
      show_promotion_amount: true,
      show_final_amount: true,
      badge_text: '🔥 Cash Out Boost',
    },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    promotionsApi
      .getCashoutBoostConfig()
      .then((cfg) => setConfig(cfg))
      .catch((err: Error) =>
        toast(`Failed to load config: ${err.message}`, 'error')
      )
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  const handleSave = () => {
    // Validate.
    if (config.promotion_value < 0) {
      toast('Promotion value must be non-negative.', 'error');
      return;
    }
    if (config.promotion_type === 'percentage' && config.promotion_value > 100) {
      toast('Percentage boost cannot exceed 100%.', 'error');
      return;
    }
    setSaving(true);
    promotionsApi
      .updateCashoutBoostConfig(config)
      .then(() => toast('Cash Out Boost settings saved.'))
      .catch((err: Error) => toast(`Failed to save: ${err.message}`, 'error'))
      .finally(() => setSaving(false));
  };

  const setAvail = (key: keyof typeof config.availability, val: boolean) =>
    setConfig((c) => ({ ...c, availability: { ...c.availability, [key]: val } }));

  const setSport = (key: keyof typeof config.sports, val: boolean) =>
    setConfig((c) => ({ ...c, sports: { ...c.sports, [key]: val } }));

  const setDisplay = (key: keyof typeof config.display, val: boolean | string) =>
    setConfig((c) => ({ ...c, display: { ...c.display, [key]: val } }));

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500 text-sm">Loading Cash Out Boost settings…</div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Cash Out Promotion</h1>
          <p className="text-sm text-gray-500 mt-1">
            Apply an optional boost on top of the existing cash out offer — never modifies the base
            calculation engine.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
        >
          {saving ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {saving ? 'Saving…' : 'Save Settings'}
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left column — config */}
        <div className="xl:col-span-2 space-y-6">

          {/* 1. Enable / Disable */}
          <SectionCard icon={Zap} title="Program Status" subtitle="Enable or disable the cash out boost globally">
            <Toggle
              checked={config.is_enabled}
              onChange={(v) => setConfig((c) => ({ ...c, is_enabled: v }))}
              label={config.is_enabled ? 'Cash Out Boost — Active' : 'Cash Out Boost — Disabled'}
              description={
                config.is_enabled
                  ? 'The boost is applied on top of the normal cash out offer when all eligibility conditions are met.'
                  : 'When disabled, the system behaves exactly as it does today — no extra calculations are performed.'
              }
            />
          </SectionCard>

          {/* 2 & 3. Promotion Type + Value */}
          <SectionCard
            icon={TrendingUp}
            title="Promotion Type & Value"
            subtitle="Choose the boost model and set its value"
          >
            <div className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Promotion Type</label>
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      { value: 'percentage', label: 'Percentage Boost', examples: '+5%, +10%, +15%' },
                      { value: 'fixed', label: 'Fixed Amount Boost', examples: '+20 ETB, +50 ETB' },
                    ] as const
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setConfig((c) => ({ ...c, promotion_type: opt.value }))}
                      className={`relative p-4 rounded-lg border-2 text-left transition-all ${
                        config.promotion_type === opt.value
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      <p className="text-sm font-semibold text-gray-900">{opt.label}</p>
                      <p className="text-xs text-gray-500 mt-1">{opt.examples}</p>
                      {config.promotion_type === opt.value && (
                        <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-blue-500" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {config.promotion_type === 'percentage'
                    ? 'Promotion Percentage (%)'
                    : 'Promotion Amount (ETB)'}
                </label>
                <div className="relative max-w-xs">
                  <input
                    type="number"
                    min={0}
                    max={config.promotion_type === 'percentage' ? 100 : undefined}
                    step={config.promotion_type === 'percentage' ? 1 : 0.01}
                    value={config.promotion_value}
                    onChange={(e) =>
                      setConfig((c) => ({ ...c, promotion_value: Number(e.target.value) }))
                    }
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 pr-16 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                  <span className="absolute right-3 top-2.5 text-sm text-gray-500 pointer-events-none">
                    {config.promotion_type === 'percentage' ? '%' : 'ETB'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {config.promotion_type === 'percentage'
                    ? `A ${config.promotion_value}% boost means a 420 ETB cash out → ${(420 * (1 + config.promotion_value / 100)).toFixed(2)} ETB`
                    : `A fixed +${config.promotion_value} ETB boost means 420 ETB → ${(420 + config.promotion_value).toFixed(2)} ETB`}
                </p>
              </div>
            </div>
          </SectionCard>

          {/* 4. Availability */}
          <SectionCard
            icon={CheckSquare}
            title="Promotion Availability"
            subtitle="Choose which bet types qualify for the boost"
          >
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  { key: 'live_bets', label: 'Live Bets' },
                  { key: 'prematch_bets', label: 'Pre-Match Bets' },
                  { key: 'single_bets', label: 'Single Bets' },
                  { key: 'multiple_bets', label: 'Multiple Bets (Accumulator)' },
                  { key: 'system_bets', label: 'System Bets' },
                ] as const
              ).map(({ key, label }) => (
                <CheckboxRow
                  key={key}
                  checked={config.availability[key]}
                  onChange={(v) => setAvail(key, v)}
                  label={label}
                />
              ))}
            </div>
          </SectionCard>

          {/* 5. Sport Configuration */}
          <SectionCard
            icon={Settings}
            title="Sport Configuration"
            subtitle="Apply the boost only for selected sports (does not affect standard cashout availability)"
          >
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {(
                [
                  { key: 'football', label: '⚽ Football' },
                  { key: 'basketball', label: '🏀 Basketball' },
                  { key: 'tennis', label: '🎾 Tennis' },
                  { key: 'volleyball', label: '🏐 Volleyball' },
                  { key: 'esports', label: '🎮 eSports' },
                  { key: 'virtual', label: '🖥️ Virtual Sports' },
                  { key: 'others', label: '🏅 Others' },
                ] as const
              ).map(({ key, label }) => (
                <CheckboxRow
                  key={key}
                  checked={config.sports[key]}
                  onChange={(v) => setSport(key, v)}
                  label={label}
                />
              ))}
            </div>
          </SectionCard>

          {/* 6. Display Configuration */}
          <SectionCard
            icon={Eye}
            title="Display Configuration"
            subtitle="Control what users see on their cash out offer"
          >
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Toggle
                  checked={config.display.show_badge}
                  onChange={(v) => setDisplay('show_badge', v)}
                  label="Show Promotion Badge"
                />
                <Toggle
                  checked={config.display.show_original_amount}
                  onChange={(v) => setDisplay('show_original_amount', v)}
                  label="Show Original Cash Out Amount"
                />
                <Toggle
                  checked={config.display.show_promotion_amount}
                  onChange={(v) => setDisplay('show_promotion_amount', v)}
                  label="Show Promotion Amount"
                />
                <Toggle
                  checked={config.display.show_final_amount}
                  onChange={(v) => setDisplay('show_final_amount', v)}
                  label="Show Final Cash Out Amount"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Badge Text</label>
                <input
                  type="text"
                  maxLength={60}
                  value={config.display.badge_text}
                  onChange={(e) => setDisplay('badge_text', e.target.value)}
                  placeholder="e.g. 🔥 Cash Out Boost"
                  className="block w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Examples: &quot;🔥 Cash Out Boost&quot; · &quot;⭐ +10% Extra Cash Out&quot;
                </p>
              </div>
            </div>
          </SectionCard>

          {/* 7. Security notice */}
          <SectionCard
            icon={Shield}
            title="Security & Calculation Rules"
            subtitle="How the promotion is applied"
          >
            <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
              <li>The existing cashout engine calculates the normal offer (unchanged).</li>
              <li>The server checks whether the promotion is enabled.</li>
              <li>The server verifies the ticket meets the eligibility rules above.</li>
              <li>The server applies the configured boost on top of the normal offer.</li>
              <li>The final (boosted) amount is credited to the user's wallet.</li>
            </ol>
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <strong>Important:</strong> All promotion calculations are performed server-side.
              Clients cannot manipulate the boost amount. The original cashout logic is never
              modified.
            </div>
          </SectionCard>

        </div>

        {/* Right column — preview */}
        <div className="space-y-6">
          <SectionCard
            icon={DollarSign}
            title="Live Preview"
            subtitle="How the offer looks to users (example: 420 ETB base)"
          >
            <BoostPreview config={config} />
          </SectionCard>

          {/* Quick stats placeholder */}
          <SectionCard icon={TrendingUp} title="Reporting Fields">
            <ul className="text-xs text-gray-600 space-y-1.5">
              {[
                'Total Boost Paid',
                'Total Boosted Cash Outs',
                'Average Boost Amount',
                'Promotion Type Used',
                'Promotion Cost',
              ].map((f) => (
                <li key={f} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <p className="text-xs text-gray-400 mt-3">
              These fields are stored in transaction metadata and available in the Reports module.
            </p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
