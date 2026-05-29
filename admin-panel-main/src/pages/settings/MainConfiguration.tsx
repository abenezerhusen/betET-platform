import React, { useEffect, useState } from 'react';
import { Settings, Save } from 'lucide-react';
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
    ])
      .then(([tx, mobile, referral, bonus, slip, vc, loyalty, streak, rules, expiry]) => {
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
