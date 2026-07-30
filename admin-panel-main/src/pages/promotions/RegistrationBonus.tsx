import React, { useEffect, useState } from 'react';
import {
  Gift,
  Zap,
  DollarSign,
  Shield,
  Save,
  RefreshCw,
  Layers,
  Target,
  Clock,
} from 'lucide-react';
import { toast } from '../../lib/toast';
import * as promotionsApi from '../../lib/api/promotions';
import type { RegistrationBonusConfig } from '../../lib/api/promotions';
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

const Checkbox = ({
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
  <label className="flex items-start gap-3 cursor-pointer select-none">
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
    />
    <span>
      <span className="text-sm font-medium text-gray-900">{label}</span>
      {description && <span className="block text-xs text-gray-500">{description}</span>}
    </span>
  </label>
);

const PRODUCT_LABELS: Array<{
  key: keyof RegistrationBonusConfig['products'];
  label: string;
  description: string;
}> = [
  { key: 'sportsbook', label: 'Sportsbook', description: 'Pre-match & live sports bets' },
  { key: 'football', label: 'Football only', description: 'Restrict sportsbook to football' },
  { key: 'virtual', label: 'Virtual Sports', description: 'Virtual leagues & games' },
  { key: 'casino', label: 'Casino / Games', description: 'Slots and casino games' },
];

/* ─────────────────────────── Main Page ─────────────────────────────── */

export default function RegistrationBonus() {
  const { isAuthenticated } = useAuthStore();
  const [config, setConfig] = useState<RegistrationBonusConfig>({
    is_enabled: false,
    amount: 0,
    products: { sportsbook: true, football: false, virtual: false, casino: false },
    sportsbook_rules: { min_selections: 0, min_odds: 0 },
    wagering_multiplier: 0,
    expires_in_days: 0,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    setLoading(true);
    promotionsApi
      .getRegistrationBonusConfig()
      .then((cfg) => setConfig(cfg))
      .catch((err: Error) => toast(`Failed to load config: ${err.message}`, 'error'))
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  const handleSave = () => {
    if (config.amount < 0) {
      toast('Bonus amount must be non-negative.', 'error');
      return;
    }
    if (config.is_enabled && config.amount <= 0) {
      toast('Set a bonus amount greater than 0 to enable the registration bonus.', 'error');
      return;
    }
    setSaving(true);
    promotionsApi
      .updateRegistrationBonusConfig(config)
      .then(() => toast('Registration bonus settings saved.'))
      .catch((err: Error) => toast(`Failed to save: ${err.message}`, 'error'))
      .finally(() => setSaving(false));
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-gray-500 text-sm">
        Loading registration bonus settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Registration Bonus</h1>
          <p className="text-sm text-gray-500 mt-1">
            Automatically credit a non-withdrawable bonus to every new user the moment they
            register. The amount lands in the user's bonus balance and follows the platform's
            standard bonus (wagering) rules — it cannot be withdrawn directly.
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
          {/* 1. Enable / Disable */}
          <SectionCard
            icon={Zap}
            title="Program Status"
            subtitle="Enable or disable the registration bonus globally"
          >
            <Toggle
              checked={config.is_enabled}
              onChange={(v) => setConfig((c) => ({ ...c, is_enabled: v }))}
              label={config.is_enabled ? 'Registration Bonus — Active' : 'Registration Bonus — Disabled'}
              description={
                config.is_enabled
                  ? 'Every newly registered user is credited the bonus amount below (non-withdrawable).'
                  : 'When disabled, new users receive no signup bonus — registration behaves exactly as before.'
              }
            />
          </SectionCard>

          {/* 2. Bonus amount */}
          <SectionCard
            icon={DollarSign}
            title="Bonus Amount"
            subtitle="How much non-withdrawable bonus each new account receives"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Bonus Amount (ETB)
              </label>
              <div className="relative max-w-xs">
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={config.amount}
                  onChange={(e) =>
                    setConfig((c) => ({ ...c, amount: Number(e.target.value) }))
                  }
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 pr-16 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
                <span className="absolute right-3 top-2.5 text-sm text-gray-500 pointer-events-none">
                  ETB
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                New users will instantly receive{' '}
                <span className="font-semibold text-gray-700">
                  {config.amount.toFixed(2)} ETB
                </span>{' '}
                in bonus balance on registration.
              </p>
            </div>
          </SectionCard>

          {/* 3. Applicable products */}
          <SectionCard
            icon={Layers}
            title="Applicable Products"
            subtitle="Where this bonus can be wagered / used"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {PRODUCT_LABELS.map((p) => (
                <Checkbox
                  key={p.key}
                  checked={Boolean(config.products?.[p.key])}
                  onChange={(v) =>
                    setConfig((c) => ({
                      ...c,
                      products: { ...c.products, [p.key]: v },
                    }))
                  }
                  label={p.label}
                  description={p.description}
                />
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-4">
              The bonus only clears (converts to cash) when it is wagered on a selected product.
              Football is a sub-restriction of sportsbook.
            </p>
          </SectionCard>

          {/* 4. Sportsbook usage rules */}
          {(config.products?.sportsbook || config.products?.football) && (
            <SectionCard
              icon={Target}
              title="Sportsbook Usage Rules"
              subtitle="International-model conditions for qualifying bets"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Minimum matches per bet
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={1}
                    value={config.sportsbook_rules?.min_selections ?? 0}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        sportsbook_rules: {
                          ...c.sportsbook_rules,
                          min_selections: Math.max(0, Math.floor(Number(e.target.value))),
                        },
                      }))
                    }
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    e.g. <strong>10</strong> — the bet must combine at least this many matches.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Minimum odds per match
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={config.sportsbook_rules?.min_odds ?? 0}
                    onChange={(e) =>
                      setConfig((c) => ({
                        ...c,
                        sportsbook_rules: {
                          ...c.sportsbook_rules,
                          min_odds: Math.max(0, Number(e.target.value)),
                        },
                      }))
                    }
                    className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    e.g. <strong>1.50</strong> — each selection must be priced at or above this.
                  </p>
                </div>
              </div>
            </SectionCard>
          )}

          {/* 5. Wagering & validity */}
          <SectionCard
            icon={Clock}
            title="Wagering & Validity"
            subtitle="Turnover requirement and expiry"
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Wagering multiplier (×)
                </label>
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={config.wagering_multiplier ?? 0}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      wagering_multiplier: Math.max(0, Number(e.target.value)),
                    }))
                  }
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Must wager{' '}
                  <span className="font-semibold text-gray-700">
                    {(config.amount * (config.wagering_multiplier || 0)).toFixed(2)} ETB
                  </span>{' '}
                  before the bonus converts to cash. 0 = no turnover requirement.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Validity (days)
                </label>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={config.expires_in_days ?? 0}
                  onChange={(e) =>
                    setConfig((c) => ({
                      ...c,
                      expires_in_days: Math.max(0, Math.floor(Number(e.target.value))),
                    }))
                  }
                  className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Bonus expires this many days after signup. 0 = never expires.
                </p>
              </div>
            </div>
          </SectionCard>

          {/* 6. How it works */}
          <SectionCard icon={Shield} title="How It Works" subtitle="Server-side rules">
            <ol className="text-sm text-gray-700 space-y-2 list-decimal list-inside">
              <li>A new user completes registration on the user panel.</li>
              <li>If this program is enabled, the server credits the configured amount.</li>
              <li>
                The amount is added to the user's <strong>bonus balance</strong> (non-withdrawable),
                never to the cash / withdrawable balance.
              </li>
              <li>
                The bonus can only be wagered on the <strong>selected products</strong>. For
                sportsbook it must be used on bets meeting the <strong>minimum matches</strong> and{' '}
                <strong>minimum odds</strong> rules above.
              </li>
              <li>
                It converts to withdrawable cash only after the{' '}
                <strong>wagering requirement</strong> is met, then expires per the validity window.
              </li>
              <li>Each account can only receive the registration bonus once.</li>
            </ol>
            <div className="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <strong>Note:</strong> The bonus grant is best-effort — if it ever fails it will never
              block a user from registering. All crediting happens server-side.
            </div>
          </SectionCard>
        </div>

        {/* Right column — preview */}
        <div className="space-y-6">
          <SectionCard
            icon={Gift}
            title="Live Preview"
            subtitle="What a new user receives on signup"
          >
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg border border-blue-200 p-5 space-y-3">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide">
                New User Welcome
              </p>
              <div className="flex items-center gap-3">
                <div className="p-3 bg-white rounded-full shadow-sm">
                  <Gift className="h-6 w-6 text-blue-600" />
                </div>
                <div>
                  <p className="text-2xl font-bold text-gray-900">
                    {config.is_enabled ? config.amount.toFixed(2) : '0.00'} ETB
                  </p>
                  <p className="text-xs text-gray-500">Bonus balance (non-withdrawable)</p>
                </div>
              </div>
              {!config.is_enabled && (
                <p className="text-xs text-amber-600 bg-amber-50 rounded px-3 py-1.5">
                  Program is currently disabled — new users receive no signup bonus.
                </p>
              )}
            </div>

            {config.is_enabled && (
              <div className="mt-4 space-y-2 text-xs text-gray-600">
                <div className="flex flex-wrap gap-1.5">
                  {PRODUCT_LABELS.filter((p) => config.products?.[p.key]).map((p) => (
                    <span
                      key={p.key}
                      className="inline-flex items-center rounded-full bg-blue-100 text-blue-700 px-2.5 py-0.5 text-[11px] font-medium"
                    >
                      {p.label}
                    </span>
                  ))}
                  {PRODUCT_LABELS.every((p) => !config.products?.[p.key]) && (
                    <span className="text-amber-600">No product selected — bonus cannot clear.</span>
                  )}
                </div>
                {(config.products?.sportsbook || config.products?.football) &&
                  (config.sportsbook_rules?.min_selections > 0 ||
                    config.sportsbook_rules?.min_odds > 0) && (
                    <p>
                      Sportsbook: min{' '}
                      <strong>{config.sportsbook_rules?.min_selections || 0}</strong> matches @{' '}
                      <strong>{(config.sportsbook_rules?.min_odds || 0).toFixed(2)}</strong>+ odds
                      each.
                    </p>
                  )}
                <p>
                  Turnover:{' '}
                  <strong>
                    {(config.amount * (config.wagering_multiplier || 0)).toFixed(2)} ETB
                  </strong>{' '}
                  · Expires:{' '}
                  <strong>
                    {config.expires_in_days > 0 ? `${config.expires_in_days} days` : 'never'}
                  </strong>
                </p>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
