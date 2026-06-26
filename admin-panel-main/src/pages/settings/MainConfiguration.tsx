import React, { useEffect, useState } from 'react';
import { Settings, Save, Clock, Ban } from 'lucide-react';
import { toast } from '../../lib/toast';
import * as settingsApi from '../../lib/api/settings';
import * as tournamentsApi from '../../lib/api/tournaments';
import { useAuthStore } from '../../store/auth';

type JsonObj = Record<string, unknown>;

const defaultBettingRules: settingsApi.MainConfig = {
  min_bet_stake: 5,
  max_bet_stake: 100000,
  max_accumulator_legs: 20,
  max_total_odds: 1000,
  tax_on_winnings_pct: 15,
  winning_tax_threshold: 1000,
  cashout_enabled: true,
  live_betting_enabled: true,
  max_payout_per_slip: 500000,
};

export function MainConfiguration() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [selectedConfig, setSelectedConfig] = useState<string | null>(null);
  const [transactionConfig, setTransactionConfig] = useState<JsonObj>({});
  const [mobileAppConfig, setMobileAppConfig] = useState<JsonObj>({});
  const [referralConfig, setReferralConfig] = useState<JsonObj>({});
  const [bonusConfig, setBonusConfig] = useState<JsonObj>({});
  const [slipConfig, setSlipConfig] = useState<JsonObj>({});
  const [virtualCasinoConfig, setVirtualCasinoConfig] = useState<JsonObj>({});
  const [loyaltyConfig, setLoyaltyConfig] = useState<JsonObj>({});
  const [streakConfig, setStreakConfig] = useState<JsonObj>({});
  const [bettingRules, setBettingRules] = useState<settingsApi.MainConfig>(defaultBettingRules);
  const [ticketExpiryDays, setTicketExpiryDays] = useState<number>(7);
  // Cashout thresholds (main.cashout). These control which pending tickets
  // are eligible for early cashout on the user panel. When the block is
  // missing the backend falls back to hardcoded defaults, so the admin
  // must configure them here for cashout to actually appear on tickets.
  const [cashoutConfig, setCashoutConfig] = useState({
    min_total_odd: 1.5,
    min_stake: 50,
    min_individual_odd: 1.2,
    min_matches: 2,
    win_criteria: 'percentage' as 'percentage' | 'amount',
    win_criteria_value: 80,
    max_cashout_amount: 10000,
    allow_bonus_cashout: false,
    allow_abandoned_match: true,
    retention_rate: 15,
  });
  const [savingCashout, setSavingCashout] = useState(false);
  // Settlement Rules state
  const [settlementConfig, setSettlementConfig] = useState({
    postponement_wait_hours: 48,
    allow_user_cancel: false,
    cancel_window_minutes: 30,
  });
  const [savingSettlement, setSavingSettlement] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingRules, setSavingRules] = useState(false);

  const configItems = [
    { id: 'transaction', name: 'Transaction' },
    { id: 'mobileApp', name: 'Mobile App' },
    { id: 'referral', name: 'Referral' },
    { id: 'bonus', name: 'Bonus' },
    { id: 'slip', name: 'Slip' },
    { id: 'virtualCasino', name: 'Virtual & Casino' },
    { id: 'loyalty', name: 'Loyalty Program' },
    { id: 'streak', name: 'Streak' },
  ];

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      settingsApi.getSetting('main.transaction').catch(() => null),
      settingsApi.getSetting('main.mobile_app').catch(() => null),
      settingsApi.getSetting('main.referral').catch(() => null),
      settingsApi.getSetting('main.bonus').catch(() => null),
      settingsApi.getSetting('main.slip').catch(() => null),
      settingsApi.getSetting('main.virtual_casino').catch(() => null),
      settingsApi.getSetting('main.loyalty').catch(() => null),
      tournamentsApi.getStreakConfig().catch(() => null),
      settingsApi.getMainConfig().catch(() => ({} as settingsApi.MainConfig)),
      settingsApi.getSetting('ticket_expiry_days').catch(() => null),
      settingsApi.getSetting('settlement.config').catch(() => null),
      settingsApi.getSetting('main.cashout').catch(() => null),
    ])
      .then(([tx, mobile, referral, bonus, slip, vc, loyalty, streak, rules, expiry, settlement, cashout]) => {
        if (cancelled) return;
        setTransactionConfig((tx?.value as JsonObj) ?? {});
        setMobileAppConfig((mobile?.value as JsonObj) ?? {});
        setReferralConfig((referral?.value as JsonObj) ?? {});
        setBonusConfig((bonus?.value as JsonObj) ?? {});
        setSlipConfig((slip?.value as JsonObj) ?? {});
        setVirtualCasinoConfig((vc?.value as JsonObj) ?? {});
        setLoyaltyConfig((loyalty?.value as JsonObj) ?? {});
        setStreakConfig((streak as unknown as JsonObj) ?? {});
        setBettingRules({ ...defaultBettingRules, ...(rules ?? {}) });
        const raw = expiry?.value;
        const days = typeof raw === 'number' ? raw : Number(raw ?? 7);
        setTicketExpiryDays(Number.isFinite(days) && days >= 1 ? days : 7);
        if (settlement?.value && typeof settlement.value === 'object') {
          const sv = settlement.value as Record<string, unknown>;
          setSettlementConfig({
            postponement_wait_hours: typeof sv.postponement_wait_hours === 'number' ? sv.postponement_wait_hours : 48,
            allow_user_cancel: sv.allow_user_cancel === true,
            cancel_window_minutes: typeof sv.cancel_window_minutes === 'number' ? sv.cancel_window_minutes : 30,
          });
        }
        if (cashout?.value && typeof cashout.value === 'object') {
          // The cashout block may be nested under "cashout" OR flat at the
          // top level — normalise the same way loadBettingConfig does.
          const raw = cashout.value as Record<string, unknown>;
          const flat = (raw.cashout as Record<string, unknown> | undefined) ?? raw;
          const num = (v: unknown, fallback: number) =>
            typeof v === 'number' ? v : v != null ? Number(v) : fallback;
          setCashoutConfig({
            min_total_odd: num(flat.min_total_odd, 1.5),
            min_stake: num(flat.min_stake, 50),
            min_individual_odd: num(flat.min_individual_odd, 1.2),
            min_matches: num(flat.min_matches, 2),
            win_criteria: flat.win_criteria === 'amount' ? 'amount' : 'percentage',
            win_criteria_value: num(flat.win_criteria_value, 80),
            max_cashout_amount: num(flat.max_cashout_amount, 10000),
            allow_bonus_cashout: flat.allow_bonus_cashout === true,
            allow_abandoned_match: flat.allow_abandoned_match !== false,
            retention_rate: num(flat.retention_rate, 15),
          });
        }
      })
      .catch((err: Error) => toast(`Failed to load configurations: ${err.message ?? err}`, 'error'))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuth]);

  const saveCurrent = async () => {
    if (!selectedConfig || saving) return;
    setSaving(true);
    try {
      if (selectedConfig === 'streak') {
        await tournamentsApi.updateStreakConfig(
          streakConfig as Partial<tournamentsApi.StreakConfig>
        );
      } else {
        const keyMap: Record<string, string> = {
          transaction: 'main.transaction',
          mobileApp: 'main.mobile_app',
          referral: 'main.referral',
          bonus: 'main.bonus',
          slip: 'main.slip',
          virtualCasino: 'main.virtual_casino',
          loyalty: 'main.loyalty',
        };
        const valueMap: Record<string, JsonObj> = {
          transaction: transactionConfig,
          mobileApp: mobileAppConfig,
          referral: referralConfig,
          bonus: bonusConfig,
          slip: slipConfig,
          virtualCasino: virtualCasinoConfig,
          loyalty: loyaltyConfig,
        };
        await settingsApi.upsertSetting(keyMap[selectedConfig], valueMap[selectedConfig]);
      }
      toast('Configuration saved.');
      setSelectedConfig(null);
    } catch (err) {
      toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const getRaw = (): string => {
    switch (selectedConfig) {
      case 'transaction':
        return JSON.stringify(transactionConfig, null, 2);
      case 'mobileApp':
        return JSON.stringify(mobileAppConfig, null, 2);
      case 'referral':
        return JSON.stringify(referralConfig, null, 2);
      case 'bonus':
        return JSON.stringify(bonusConfig, null, 2);
      case 'slip':
        return JSON.stringify(slipConfig, null, 2);
      case 'virtualCasino':
        return JSON.stringify(virtualCasinoConfig, null, 2);
      case 'loyalty':
        return JSON.stringify(loyaltyConfig, null, 2);
      case 'streak':
        return JSON.stringify(streakConfig, null, 2);
      default:
        return '{}';
    }
  };

  const setRaw = (raw: string) => {
    try {
      const parsed = (JSON.parse(raw) ?? {}) as JsonObj;
      switch (selectedConfig) {
        case 'transaction':
          setTransactionConfig(parsed);
          break;
        case 'mobileApp':
          setMobileAppConfig(parsed);
          break;
        case 'referral':
          setReferralConfig(parsed);
          break;
        case 'bonus':
          setBonusConfig(parsed);
          break;
        case 'slip':
          setSlipConfig(parsed);
          break;
        case 'virtualCasino':
          setVirtualCasinoConfig(parsed);
          break;
        case 'loyalty':
          setLoyaltyConfig(parsed);
          break;
        case 'streak':
          setStreakConfig(parsed);
          break;
      }
    } catch {
      // Keep editing until JSON is valid.
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Settings className="h-8 w-8 text-gray-600" />
        <h1 className="text-2xl font-semibold text-gray-900">Main Configuration</h1>
      </div>

      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Core Betting Rules</h2>
          <p className="text-xs text-gray-500">
            Mapped to <code>GET/PUT /api/admin/settings/main</code>. These rules are read by the
            slip validator on every bet placement.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
          <label className="space-y-1">
            <span className="text-gray-700">Min bet stake</span>
            <input
              type="number"
              min={0}
              value={bettingRules.min_bet_stake ?? 0}
              onChange={(e) =>
                setBettingRules((p) => ({ ...p, min_bet_stake: Number(e.target.value || 0) }))
              }
              className="w-full rounded-md border-gray-300"
            />
          </label>
          <label className="space-y-1">
            <span className="text-gray-700">Max bet stake</span>
            <input
              type="number"
              min={0}
              value={bettingRules.max_bet_stake ?? 0}
              onChange={(e) =>
                setBettingRules((p) => ({ ...p, max_bet_stake: Number(e.target.value || 0) }))
              }
              className="w-full rounded-md border-gray-300"
            />
          </label>
          <label className="space-y-1">
            <span className="text-gray-700">Max accumulator legs</span>
            <input
              type="number"
              min={1}
              value={bettingRules.max_accumulator_legs ?? 0}
              onChange={(e) =>
                setBettingRules((p) => ({
                  ...p,
                  max_accumulator_legs: Number(e.target.value || 0),
                }))
              }
              className="w-full rounded-md border-gray-300"
            />
          </label>
          <label className="space-y-1">
            <span className="text-gray-700">Max total odds</span>
            <input
              type="number"
              min={1}
              value={bettingRules.max_total_odds ?? 0}
              onChange={(e) =>
                setBettingRules((p) => ({ ...p, max_total_odds: Number(e.target.value || 0) }))
              }
              className="w-full rounded-md border-gray-300"
            />
          </label>
          <label className="space-y-1">
            <span className="text-gray-700">Tax on winnings %</span>
            <input
              type="number"
              min={0}
              max={100}
              value={bettingRules.tax_on_winnings_pct ?? 0}
              onChange={(e) =>
                setBettingRules((p) => ({
                  ...p,
                  tax_on_winnings_pct: Number(e.target.value || 0),
                }))
              }
              className="w-full rounded-md border-gray-300"
            />
          </label>
          <label className="space-y-1">
            <span className="text-gray-700">Tax threshold</span>
            <input
              type="number"
              min={0}
              value={bettingRules.winning_tax_threshold ?? 0}
              onChange={(e) =>
                setBettingRules((p) => ({
                  ...p,
                  winning_tax_threshold: Number(e.target.value || 0),
                }))
              }
              className="w-full rounded-md border-gray-300"
            />
          </label>
          <label className="space-y-1">
            <span className="text-gray-700">Max payout per slip</span>
            <input
              type="number"
              min={0}
              value={bettingRules.max_payout_per_slip ?? 0}
              onChange={(e) =>
                setBettingRules((p) => ({
                  ...p,
                  max_payout_per_slip: Number(e.target.value || 0),
                }))
              }
              className="w-full rounded-md border-gray-300"
            />
          </label>
          <label className="space-y-1 flex flex-col">
            <span className="text-gray-700">Cashout enabled</span>
            <select
              value={String(Boolean(bettingRules.cashout_enabled))}
              onChange={(e) =>
                setBettingRules((p) => ({ ...p, cashout_enabled: e.target.value === 'true' }))
              }
              className="rounded-md border-gray-300"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="space-y-1 flex flex-col">
            <span className="text-gray-700">Live betting enabled</span>
            <select
              value={String(Boolean(bettingRules.live_betting_enabled))}
              onChange={(e) =>
                setBettingRules((p) => ({
                  ...p,
                  live_betting_enabled: e.target.value === 'true',
                }))
              }
              className="rounded-md border-gray-300"
            >
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-gray-700">Ticket Payout Expiry (days)</span>
            <input
              type="number"
              min={1}
              max={365}
              value={ticketExpiryDays}
              onChange={(e) =>
                setTicketExpiryDays(Math.max(1, Number(e.target.value || 1)))
              }
              className="w-full rounded-md border-gray-300"
            />
            <span className="block text-[11px] text-gray-500">
              Cashiers can pay winning tickets up to this many days after they
              are issued. Default 7.
            </span>
          </label>
        </div>
        <div className="flex justify-end">
          <button
            onClick={async () => {
              setSavingRules(true);
              try {
                await Promise.all([
                  settingsApi.updateMainConfig(bettingRules),
                  settingsApi.upsertSetting(
                    'ticket_expiry_days',
                    Math.floor(ticketExpiryDays),
                  ),
                ]);
                toast('Betting rules saved.');
              } catch (err) {
                toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
              } finally {
                setSavingRules(false);
              }
            }}
            disabled={savingRules}
            className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
          >
            <Save className="h-4 w-4 mr-2" />
            {savingRules ? 'Saving...' : 'Save Rules'}
          </button>
        </div>
      </div>

      {/* Settlement Rules -------------------------------------------------- */}
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-blue-600" />
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Settlement Rules</h2>
            <p className="text-xs text-gray-500">
              Saved to <code>settlement.config</code>. Controls how postponed events and user
              ticket cancellation work.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
          {/* Postponement wait hours */}
          <div className="space-y-2">
            <span className="font-medium text-gray-700 flex items-center gap-1">
              <Clock className="h-4 w-4 text-orange-500" />
              Postponement Waiting Period
            </span>
            <p className="text-xs text-gray-500">
              How long to wait after an event is postponed before voiding selections and
              auto-settling.
            </p>
            <div className="flex gap-2 flex-wrap">
              {[24, 48, 72, 96, 168].map((h) => (
                <button
                  key={h}
                  onClick={() =>
                    setSettlementConfig((s) => ({ ...s, postponement_wait_hours: h }))
                  }
                  className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                    settlementConfig.postponement_wait_hours === h
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
                  }`}
                >
                  {h === 168 ? '7 days' : `${h}h`}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-gray-500">Custom hours:</span>
              <input
                type="number"
                min={1}
                max={720}
                value={settlementConfig.postponement_wait_hours}
                onChange={(e) =>
                  setSettlementConfig((s) => ({
                    ...s,
                    postponement_wait_hours: Math.max(1, Number(e.target.value || 48)),
                  }))
                }
                className="w-24 rounded-md border-gray-300 text-sm"
              />
              <span className="text-xs text-gray-500">hours</span>
            </div>
          </div>

          {/* User cancel settings */}
          <div className="space-y-2">
            <span className="font-medium text-gray-700 flex items-center gap-1">
              <Ban className="h-4 w-4 text-red-500" />
              User Self-Cancel
            </span>
            <p className="text-xs text-gray-500">
              Allow users to cancel their own pending ticket before the event starts.
            </p>
            <div className="flex items-center gap-3 py-2">
              <button
                onClick={() =>
                  setSettlementConfig((s) => ({ ...s, allow_user_cancel: true }))
                }
                className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                  settlementConfig.allow_user_cancel
                    ? 'bg-green-600 text-white border-green-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-green-400'
                }`}
              >
                Enabled
              </button>
              <button
                onClick={() =>
                  setSettlementConfig((s) => ({ ...s, allow_user_cancel: false }))
                }
                className={`px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                  !settlementConfig.allow_user_cancel
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-red-400'
                }`}
              >
                Disabled
              </button>
            </div>
            {settlementConfig.allow_user_cancel && (
              <label className="space-y-1 block">
                <span className="text-xs text-gray-600">
                  Cancel allowed within (minutes before event start):
                </span>
                <div className="flex items-center gap-2">
                  {[5, 15, 30, 60, 120].map((m) => (
                    <button
                      key={m}
                      onClick={() =>
                        setSettlementConfig((s) => ({ ...s, cancel_window_minutes: m }))
                      }
                      className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                        settlementConfig.cancel_window_minutes === m
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
                      }`}
                    >
                      {m}m
                    </button>
                  ))}
                  <input
                    type="number"
                    min={1}
                    value={settlementConfig.cancel_window_minutes}
                    onChange={(e) =>
                      setSettlementConfig((s) => ({
                        ...s,
                        cancel_window_minutes: Math.max(1, Number(e.target.value || 30)),
                      }))
                    }
                    className="w-20 rounded-md border-gray-300 text-sm"
                  />
                  <span className="text-xs text-gray-500">min</span>
                </div>
              </label>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            Current: wait <strong>{settlementConfig.postponement_wait_hours}h</strong> for
            postponed events · user cancel{' '}
            <strong>
              {settlementConfig.allow_user_cancel
                ? `enabled (${settlementConfig.cancel_window_minutes}min window)`
                : 'disabled'}
            </strong>
          </p>
          <button
            onClick={async () => {
              setSavingSettlement(true);
              try {
                await settingsApi.upsertSetting('settlement.config', settlementConfig);
                toast('Settlement rules saved.');
              } catch (err) {
                toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
              } finally {
                setSavingSettlement(false);
              }
            }}
            disabled={savingSettlement}
            className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
          >
            <Save className="h-4 w-4 mr-2" />
            {savingSettlement ? 'Saving...' : 'Save Settlement Rules'}
          </button>
        </div>
      </div>

      {/* ── Cash Out Settings ─────────────────────────────────────────── */}
      <div className="bg-white rounded-lg shadow p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Cash Out Settings</h3>
        </div>
        <p className="text-sm text-gray-600">
          These thresholds control which pending tickets show a <strong>Cash Out</strong> button
          on the user panel. The global on/off toggle lives in the Betting Rules card above
          ("Cashout enabled"). If cashout is enabled but no button appears on a ticket, the
          ticket is failing one of the rules below (e.g. a single-match ticket with
          <code className="mx-1 px-1 bg-gray-100 rounded">min_matches = 2</code>).
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <label className="space-y-1 flex flex-col">
            <span className="text-gray-700">Min total odds</span>
            <input
              type="number"
              step="0.01"
              min={1}
              value={cashoutConfig.min_total_odd}
              onChange={(e) =>
                setCashoutConfig((p) => ({ ...p, min_total_odd: Number(e.target.value || 0) }))
              }
              className="w-full rounded-md border-gray-300"
            />
            <span className="text-[11px] text-gray-500">Ticket total odds must be ≥ this.</span>
          </label>
          <label className="space-y-1 flex flex-col">
            <span className="text-gray-700">Min stake</span>
            <input
              type="number"
              min={0}
              value={cashoutConfig.min_stake}
              onChange={(e) =>
                setCashoutConfig((p) => ({ ...p, min_stake: Number(e.target.value || 0) }))
              }
              className="w-full rounded-md border-gray-300"
            />
            <span className="text-[11px] text-gray-500">Stake must be ≥ this. Set to 10 to allow low-stake tickets.</span>
          </label>
          <label className="space-y-1 flex flex-col">
            <span className="text-gray-700">Min individual odd (per leg)</span>
            <input
              type="number"
              step="0.01"
              min={1}
              value={cashoutConfig.min_individual_odd}
              onChange={(e) =>
                setCashoutConfig((p) => ({ ...p, min_individual_odd: Number(e.target.value || 0) }))
              }
              className="w-full rounded-md border-gray-300"
            />
          </label>
          <label className="space-y-1 flex flex-col">
            <span className="text-gray-700">Min matches (legs)</span>
            <input
              type="number"
              min={1}
              value={cashoutConfig.min_matches}
              onChange={(e) =>
                setCashoutConfig((p) => ({ ...p, min_matches: Number(e.target.value || 1) }))
              }
              className="w-full rounded-md border-gray-300"
            />
            <span className="text-[11px] text-gray-500">Set to 1 to allow single-match tickets.</span>
          </label>
          <label className="space-y-1 flex flex-col">
            <span className="text-gray-700">Win criteria</span>
            <select
              value={cashoutConfig.win_criteria}
              onChange={(e) =>
                setCashoutConfig((p) => ({
                  ...p,
                  win_criteria: e.target.value as 'percentage' | 'amount',
                }))
              }
              className="rounded-md border-gray-300"
            >
              <option value="percentage">Percentage of potential payout</option>
              <option value="amount">Fixed amount floor</option>
            </select>
          </label>
          <label className="space-y-1 flex flex-col">
            <span className="text-gray-700">
              {cashoutConfig.win_criteria === 'percentage'
                ? 'Min % of potential payout'
                : 'Min cashout amount (floor)'}
            </span>
            <input
              type="number"
              step="0.01"
              min={0}
              value={cashoutConfig.win_criteria_value}
              onChange={(e) =>
                setCashoutConfig((p) => ({ ...p, win_criteria_value: Number(e.target.value || 0) }))
              }
              className="w-full rounded-md border-gray-300"
            />
            <span className="text-[11px] text-gray-500">
              {cashoutConfig.win_criteria === 'percentage'
                ? 'Cashout offer must be ≥ this % of potential payout.'
                : 'Cashout offer must be ≥ this amount.'}
            </span>
          </label>
          <label className="space-y-1 flex flex-col">
            <span className="text-gray-700">Max cashout amount</span>
            <input
              type="number"
              min={0}
              value={cashoutConfig.max_cashout_amount}
              onChange={(e) =>
                setCashoutConfig((p) => ({ ...p, max_cashout_amount: Number(e.target.value || 0) }))
              }
              className="w-full rounded-md border-gray-300"
            />
          </label>
          <label className="space-y-1 flex flex-col">
            <span className="text-gray-700">Retention rate (%)</span>
            <input
              type="number"
              step="0.01"
              min={0}
              max={100}
              value={cashoutConfig.retention_rate}
              onChange={(e) =>
                setCashoutConfig((p) => ({ ...p, retention_rate: Number(e.target.value || 0) }))
              }
              className="w-full rounded-md border-gray-300"
            />
            <span className="text-[11px] text-gray-500">Platform cut on early cashout. 15 → user gets 85%.</span>
          </label>
          <label className="space-y-1 flex flex-col">
            <span className="text-gray-700">Allow bonus-funded bets</span>
            <select
              value={String(cashoutConfig.allow_bonus_cashout)}
              onChange={(e) =>
                setCashoutConfig((p) => ({ ...p, allow_bonus_cashout: e.target.value === 'true' }))
              }
              className="rounded-md border-gray-300"
            >
              <option value="false">No</option>
              <option value="true">Yes</option>
            </select>
          </label>
          <label className="space-y-1 flex flex-col">
            <span className="text-gray-700">Allow when match abandoned</span>
            <select
              value={String(cashoutConfig.allow_abandoned_match)}
              onChange={(e) =>
                setCashoutConfig((p) => ({ ...p, allow_abandoned_match: e.target.value === 'true' }))
              }
              className="rounded-md border-gray-300"
            >
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
        </div>
        <div className="pt-2">
          <button
            onClick={async () => {
              setSavingCashout(true);
              try {
                await settingsApi.upsertSetting('main.cashout', cashoutConfig);
                toast('Cash out settings saved.');
              } catch (err) {
                toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
              } finally {
                setSavingCashout(false);
              }
            }}
            disabled={savingCashout}
            className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
          >
            <Save className="h-4 w-4 mr-2" />
            {savingCashout ? 'Saving...' : 'Save Cash Out Settings'}
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Config Name
              </th>
              <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Action
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {configItems.map((item) => (
              <tr key={item.id}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{item.name}</td>
                <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
                  <button
                    onClick={() => setSelectedConfig(item.id)}
                    className="inline-flex items-center px-3 py-1.5 rounded-md text-white bg-blue-600 hover:bg-blue-700"
                  >
                    Configure
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {loading && <div className="px-6 pb-6 text-sm text-gray-500">Loading configurations…</div>}
      </div>

      {selectedConfig && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg w-full max-w-4xl">
            <div className="p-6 space-y-4">
              <div className="flex justify-between items-center">
                <h2 className="text-xl font-semibold">Edit {configItems.find((i) => i.id === selectedConfig)?.name}</h2>
                <button onClick={() => setSelectedConfig(null)} className="text-gray-500 hover:text-gray-700">
                  Close
                </button>
              </div>
              <p className="text-sm text-gray-500">
                JSON editor bound to backend settings. Invalid JSON is ignored until valid.
              </p>
              <textarea
                className="w-full h-[420px] border border-gray-300 rounded-md p-3 font-mono text-sm"
                value={getRaw()}
                onChange={(e) => setRaw(e.target.value)}
              />
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setSelectedConfig(null)}
                  className="px-4 py-2 border border-gray-300 rounded-md text-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveCurrent()}
                  className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white"
                >
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? 'Saving...' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
