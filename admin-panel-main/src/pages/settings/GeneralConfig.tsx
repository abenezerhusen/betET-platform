import React, { useEffect, useMemo, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { TabGroup } from '../../components/TabGroup';
import { Settings, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from '../../lib/toast';
import * as settingsApi from '../../lib/api/settings';
import * as paymentMethodsApi from '../../lib/api/payment-methods';
import { useAuthStore } from '../../store/auth';

/* -------------------------------------------------------------------------- */
/* Spec — Section 19                                                          */
/*                                                                            */
/* Every tab in this screen persists to one of the keys behind                */
/*    GET/PUT /api/admin/settings/general (-> settings.general.config),       */
/*    POST    /api/admin/settings/top-bets,                                   */
/*    POST    /api/admin/settings/top-matches,                                */
/*    POST    /api/admin/settings/promotions.                                 */
/*                                                                            */
/* The legacy Payment Methods read-only tab is preserved at the bottom so     */
/* the operator can still verify which gateways are wired up without          */
/* leaving this page.                                                         */
/* -------------------------------------------------------------------------- */

const defaultGeneral: settingsApi.GeneralConfig = {
  platform_name: '',
  logo_url: '',
  currency: 'ETB',
  country: '',
  country_code: '',
  timezone: 'Africa/Addis_Ababa',
  website_url: '',
  offline_bet_support: true,
  offline_payout: true,
  enable_language_selection: false,
  social_facebook: '',
  social_telegram: '',
  social_tiktok: '',
  social_instagram: '',
  social_twitter: '',
  contact_email: '',
  contact_phone: '',
  support_phone: '',
  support_email: '',
  underage_disclaimer: '',
  about_us: '',
  vip_threshold: 0,
  min_withdrawal: 0,
  max_withdrawal: 0,
  sms_events: [],
  sms_max_win_limit: 0,
  cashier_max_daily_cancel_volume: 0,
  cashier_max_stake_cancel: 0,
  cashier_cancel_window_minutes: 5,
  cashier_enable_withdraw_request: true,
  cashier_enable_duplicate_slip: false,
  cashier_max_daily_cancel_count: 0,
  operation_hours: {},
  operation_hours_enforce_bets: false,
};

/** Spec event codes for the SMS Config tab. Each toggle controls whether
 *  the backend's `sendSmsBestEffort` fires when the matching event occurs. */
const SMS_EVENT_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'registration_confirmation', label: 'Registration Confirmation' },
  { code: 'phone_confirmation', label: 'Phone Confirmation' },
  { code: 'password_reset', label: 'Password Reset' },
  { code: 'bet_placed', label: 'Bet Placed' },
  { code: 'bet_for_me_placed', label: 'Bet For Me Placed' },
  { code: 'branch_withdrawal', label: 'Branch Withdrawal' },
  { code: 'deposit_success', label: 'Deposit Success' },
  { code: 'bet_cancellation', label: 'Bet Cancellation' },
  { code: 'bet_win', label: 'Bet Win' },
  { code: 'branch_deposit', label: 'Branch Deposit' },
];

const DAYS: Array<{ key: keyof settingsApi.OperationHours; label: string }> = [
  { key: 'mon', label: 'Monday' },
  { key: 'tue', label: 'Tuesday' },
  { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' },
  { key: 'fri', label: 'Friday' },
  { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
];

export function GeneralConfig() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('company');
  const [general, setGeneral] = useState<settingsApi.GeneralConfig>(defaultGeneral);
  const [topBets, setTopBets] = useState<settingsApi.TopBetEntry[]>([]);
  const [topMatches, setTopMatches] = useState<settingsApi.TopMatchEntry[]>([]);
  const [promotions, setPromotions] = useState<settingsApi.PromotionBanner[]>([]);
  const [methods, setMethods] = useState<paymentMethodsApi.PaymentMethodRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  /* Top-bets entry form */
  const [newLeague, setNewLeague] = useState('');
  const [newGroup, setNewGroup] = useState('');
  const [newSport, setNewSport] = useState('Football');

  /* Top-matches entry form */
  const [newMatch, setNewMatch] = useState('');
  const [newMatchLeague, setNewMatchLeague] = useState('');
  const [newMatchCountry, setNewMatchCountry] = useState('');
  const [newMatchSchedule, setNewMatchSchedule] = useState('');

  /* Promotions entry form */
  const [newPromoTitle, setNewPromoTitle] = useState('');
  const [newPromoImage, setNewPromoImage] = useState('');
  const [newPromoBonus, setNewPromoBonus] = useState('');
  const [newPromoDesc, setNewPromoDesc] = useState('');

  const load = async () => {
    if (!isAuth) return;
    setLoading(true);
    try {
      const [generalRes, betsRes, matchesRes, promosRes, methodsRes] = await Promise.all([
        settingsApi.getGeneralConfig().catch(() => ({} as settingsApi.GeneralConfig)),
        settingsApi.listTopBets().catch(() => ({ items: [] })),
        settingsApi.listTopMatches().catch(() => ({ items: [] })),
        settingsApi.listPromotions().catch(() => ({ items: [] })),
        paymentMethodsApi.listPaymentMethods(),
      ]);
      setGeneral({ ...defaultGeneral, ...(generalRes ?? {}) });
      setTopBets((betsRes.items ?? []).map((r, i) => ({ ...r, id: r.id || `b-${i}` })));
      setTopMatches(
        (matchesRes.items ?? []).map((r, i) => ({ ...r, id: r.id || `m-${i}` }))
      );
      setPromotions((promosRes.items ?? []).map((r, i) => ({ ...r, id: r.id || `p-${i}` })));
      setMethods(methodsRes.items ?? []);
    } catch (err) {
      toast(`Failed to load settings: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuth]);

  /* ------------------------------------------------------------------------ */
  /* Persistence helpers — every save targets the spec endpoint directly.     */
  /* ------------------------------------------------------------------------ */

  const saveGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const out = await settingsApi.updateGeneralConfig(general);
      setGeneral({ ...defaultGeneral, ...(out ?? general) });
      toast('General settings saved.');
    } catch (err) {
      toast(`Save failed: ${(err as Error)?.message ?? err}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const persistTopBets = async (rows: settingsApi.TopBetEntry[]) => {
    setTopBets(rows);
    try {
      await settingsApi.saveTopBets(rows);
    } catch (err) {
      toast(`Failed to save top bets: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  const persistTopMatches = async (rows: settingsApi.TopMatchEntry[]) => {
    setTopMatches(rows);
    try {
      await settingsApi.saveTopMatches(rows);
    } catch (err) {
      toast(`Failed to save top matches: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  const persistPromotions = async (rows: settingsApi.PromotionBanner[]) => {
    setPromotions(rows);
    try {
      await settingsApi.savePromotions(rows);
    } catch (err) {
      toast(`Failed to save promotions: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  const toggleSmsEvent = (code: string) => {
    setGeneral((p) => {
      const set = new Set((p.sms_events ?? []).map((s) => s.toLowerCase()));
      if (set.has(code)) set.delete(code);
      else set.add(code);
      return { ...p, sms_events: Array.from(set) };
    });
  };

  const updateDayHours = (
    day: keyof settingsApi.OperationHours,
    patch: Partial<settingsApi.OperationHoursDay>
  ) => {
    setGeneral((p) => {
      const hours = { ...(p.operation_hours ?? {}) };
      const current = hours[day] ?? { open: '09:00', close: '23:00' };
      hours[day] = { ...current, ...patch };
      return { ...p, operation_hours: hours };
    });
  };

  const tabs = [
    { id: 'company', label: 'Company Info' },
    { id: 'top-bets', label: 'Top Bets' },
    { id: 'top-matches', label: 'Top Matches' },
    { id: 'promotions', label: 'Promotions' },
    { id: 'sms', label: 'SMS Config' },
    { id: 'cashier', label: 'Cashier Config' },
    { id: 'hours', label: 'Operation Hours' },
    { id: 'payment', label: 'Payment Methods' },
  ];

  const methodRows = useMemo(
    () =>
      methods.map((m) => ({
        id: m.id,
        name: m.display_name || m.provider,
        channels: m.channels.join(', '),
        currencies: m.currencies.join(', '),
        status: m.is_active ? 'Active' : 'Inactive',
      })),
    [methods]
  );

  const enabledSms = new Set((general.sms_events ?? []).map((s) => s.toLowerCase()));

  return (
    <div className="space-y-6">
      <div className="flex items-center space-x-3">
        <Settings className="h-8 w-8 text-gray-600" />
        <h1 className="text-2xl font-semibold text-gray-900">General Settings</h1>
      </div>

      <TabGroup tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* ------------------------------------------------------------------ */
        /* Company Info                                                       */
        /* ------------------------------------------------------------------ */}
      {activeTab === 'company' && (
        <div className="bg-white rounded-lg shadow p-6">
          <p className="text-xs text-gray-500 mb-4">
            Mapped to <code>GET/PUT /api/admin/settings/general</code>. These values feed the user
            panel header, cashier panel branding, language toggle, support contacts, social
            footer, age disclaimer, and the public <code>GET /api/public/general</code> endpoint.
          </p>
          <form onSubmit={saveGeneral} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <Field label="Platform name" value={general.platform_name ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, platform_name: v }))} placeholder="PlayCore" />
            <Field label="Currency" value={general.currency ?? 'ETB'} onChange={(v) => setGeneral((p) => ({ ...p, currency: v }))} placeholder="ETB" />
            <Field label="Country" value={general.country ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, country: v }))} placeholder="Ethiopia" />
            <Field label="Country code" value={general.country_code ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, country_code: v }))} placeholder="ET" />
            <Field label="Website URL" value={general.website_url ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, website_url: v }))} placeholder="https://playcore.example" />
            <Field label="Logo URL" value={general.logo_url ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, logo_url: v }))} placeholder="https://cdn.example.com/logo.png" />
            <Field label="Timezone" value={general.timezone ?? 'Africa/Addis_Ababa'} onChange={(v) => setGeneral((p) => ({ ...p, timezone: v }))} />
            <ToggleField
              label="Offline Bet Support (enables Cashier Panel)"
              value={Boolean(general.offline_bet_support)}
              onChange={(v) => setGeneral((p) => ({ ...p, offline_bet_support: v }))}
            />
            <ToggleField
              label="Offline Payout (cashiers pay winning tickets)"
              value={Boolean(general.offline_payout)}
              onChange={(v) => setGeneral((p) => ({ ...p, offline_payout: v }))}
            />
            <ToggleField
              label="Enable Language Selection"
              value={Boolean(general.enable_language_selection)}
              onChange={(v) => setGeneral((p) => ({ ...p, enable_language_selection: v }))}
            />

            <SectionHeader title="Social Links" />
            <Field label="Facebook" value={general.social_facebook ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, social_facebook: v }))} />
            <Field label="Telegram" value={general.social_telegram ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, social_telegram: v }))} />
            <Field label="TikTok" value={general.social_tiktok ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, social_tiktok: v }))} />
            <Field label="Instagram" value={general.social_instagram ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, social_instagram: v }))} />
            <Field label="Twitter / X" value={general.social_twitter ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, social_twitter: v }))} />

            <SectionHeader title="Contact" />
            <Field label="Contact email" value={general.contact_email ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, contact_email: v }))} />
            <Field label="Contact phone" value={general.contact_phone ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, contact_phone: v }))} />
            <Field label="Support email" value={general.support_email ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, support_email: v }))} />
            <Field label="Support phone" value={general.support_phone ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, support_phone: v }))} />

            <SectionHeader title="Disclaimers" />
            <label className="md:col-span-2 space-y-1">
              <span className="text-gray-700">Underage Disclaimer</span>
              <textarea
                rows={2}
                value={general.underage_disclaimer ?? ''}
                onChange={(e) => setGeneral((p) => ({ ...p, underage_disclaimer: e.target.value }))}
                className="w-full rounded-md border-gray-300"
                placeholder="No persons under 18 years of age are permitted to bet on this site."
              />
            </label>
            <label className="md:col-span-2 space-y-1">
              <span className="text-gray-700">About Us</span>
              <textarea
                rows={4}
                value={general.about_us ?? ''}
                onChange={(e) => setGeneral((p) => ({ ...p, about_us: e.target.value }))}
                className="w-full rounded-md border-gray-300"
              />
            </label>

            <div className="md:col-span-2 flex justify-end">
              <button
                type="submit"
                disabled={saving || loading}
                className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
              >
                <Save className="h-4 w-4 mr-2" />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ------------------------------------------------------------------ */
        /* Top Bets                                                          */
        /* ------------------------------------------------------------------ */}
      {activeTab === 'top-bets' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <p className="text-xs text-gray-500">
            Saved to <code>POST /api/admin/settings/top-bets</code>. The user panel renders these
            leagues in the "Top Bets" section of the home page.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input value={newLeague} onChange={(e) => setNewLeague(e.target.value)} placeholder="League (e.g. Premier League)" className="rounded-md border-gray-300" />
            <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="League group" className="rounded-md border-gray-300" />
            <input value={newSport} onChange={(e) => setNewSport(e.target.value)} placeholder="Sport" className="rounded-md border-gray-300" />
            <button
              onClick={() => {
                if (!newLeague.trim()) return;
                void persistTopBets([
                  ...topBets,
                  {
                    id: String(Date.now()),
                    league: newLeague.trim(),
                    league_group: newGroup.trim(),
                    sport_type: newSport.trim() || 'Football',
                  },
                ]);
                setNewLeague('');
                setNewGroup('');
              }}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-blue-600 text-white"
            >
              <Plus className="h-4 w-4 mr-2" /> Add
            </button>
          </div>
          <DataTable
            columns={[
              { header: 'League', accessor: 'league' as const },
              {
                header: 'Group',
                accessor: 'league_group' as const,
                render: (_v, row: settingsApi.TopBetEntry) =>
                  String(row.league_group ?? row.leagueGroup ?? '—'),
              },
              {
                header: 'Sport',
                accessor: 'sport_type' as const,
                render: (_v, row: settingsApi.TopBetEntry) =>
                  String(row.sport_type ?? row.sportType ?? '—'),
              },
              {
                header: 'Action',
                accessor: 'id' as const,
                render: (value: string) => (
                  <button
                    className="text-red-600"
                    onClick={() => void persistTopBets(topBets.filter((r) => r.id !== value))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ),
              },
            ]}
            data={topBets}
          />
        </div>
      )}

      {/* ------------------------------------------------------------------ */
        /* Top Matches                                                       */
        /* ------------------------------------------------------------------ */}
      {activeTab === 'top-matches' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <p className="text-xs text-gray-500">
            Saved to <code>POST /api/admin/settings/top-matches</code>. These appear as Featured
            Matches on the user panel home page.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input value={newMatch} onChange={(e) => setNewMatch(e.target.value)} placeholder="Match (Team A vs Team B)" className="rounded-md border-gray-300" />
            <input value={newMatchLeague} onChange={(e) => setNewMatchLeague(e.target.value)} placeholder="League" className="rounded-md border-gray-300" />
            <input value={newMatchCountry} onChange={(e) => setNewMatchCountry(e.target.value)} placeholder="Country" className="rounded-md border-gray-300" />
            <input value={newMatchSchedule} onChange={(e) => setNewMatchSchedule(e.target.value)} placeholder="Schedule (ISO date)" className="rounded-md border-gray-300" />
            <button
              onClick={() => {
                if (!newMatch.trim()) return;
                void persistTopMatches([
                  ...topMatches,
                  {
                    id: String(Date.now()),
                    match: newMatch.trim(),
                    league: newMatchLeague.trim() || '—',
                    country: newMatchCountry.trim() || '—',
                    sport_type: 'Football',
                    schedule: newMatchSchedule.trim() || new Date().toISOString(),
                  },
                ]);
                setNewMatch('');
                setNewMatchLeague('');
                setNewMatchCountry('');
                setNewMatchSchedule('');
              }}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-blue-600 text-white"
            >
              <Plus className="h-4 w-4 mr-2" /> Add
            </button>
          </div>
          <DataTable
            columns={[
              {
                header: 'Match',
                accessor: 'match' as const,
                render: (_v, row: settingsApi.TopMatchEntry) =>
                  String(row.match ?? `${row.home_team ?? '?'} vs ${row.away_team ?? '?'}`),
              },
              { header: 'League', accessor: 'league' as const },
              { header: 'Country', accessor: 'country' as const },
              { header: 'Schedule', accessor: 'schedule' as const },
              {
                header: 'Action',
                accessor: 'id' as const,
                render: (value: string) => (
                  <button
                    className="text-red-600"
                    onClick={() => void persistTopMatches(topMatches.filter((r) => r.id !== value))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ),
              },
            ]}
            data={topMatches}
          />
        </div>
      )}

      {/* ------------------------------------------------------------------ */
        /* Promotions                                                         */
        /* ------------------------------------------------------------------ */}
      {activeTab === 'promotions' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <p className="text-xs text-gray-500">
            Saved to <code>POST /api/admin/settings/promotions</code>. These banners feed the
            hero carousel on the user panel promotions page.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <input value={newPromoTitle} onChange={(e) => setNewPromoTitle(e.target.value)} placeholder="Title (e.g. 100% Welcome Bonus)" className="rounded-md border-gray-300" />
            <input value={newPromoBonus} onChange={(e) => setNewPromoBonus(e.target.value)} placeholder="Bonus type (e.g. deposit_match)" className="rounded-md border-gray-300" />
            <input value={newPromoImage} onChange={(e) => setNewPromoImage(e.target.value)} placeholder="Image URL" className="rounded-md border-gray-300" />
            <button
              onClick={() => {
                if (!newPromoTitle.trim() || !newPromoImage.trim()) return;
                void persistPromotions([
                  ...promotions,
                  {
                    id: String(Date.now()),
                    title: newPromoTitle.trim(),
                    image_url: newPromoImage.trim(),
                    bonus_type: newPromoBonus.trim() || 'deposit_match',
                    description: newPromoDesc.trim(),
                    is_active: true,
                    display_order: promotions.length,
                  },
                ]);
                setNewPromoTitle('');
                setNewPromoBonus('');
                setNewPromoImage('');
                setNewPromoDesc('');
              }}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-blue-600 text-white"
            >
              <Plus className="h-4 w-4 mr-2" /> Add Banner
            </button>
          </div>
          <label className="block">
            <span className="text-xs text-gray-600">Description (optional)</span>
            <textarea
              rows={2}
              value={newPromoDesc}
              onChange={(e) => setNewPromoDesc(e.target.value)}
              className="w-full rounded-md border-gray-300"
            />
          </label>
          <DataTable
            columns={[
              { header: 'Title', accessor: 'title' as const },
              { header: 'Bonus type', accessor: 'bonus_type' as const },
              {
                header: 'Image',
                accessor: 'image_url' as const,
                render: (value: string) => (
                  <a href={value} target="_blank" rel="noreferrer" className="text-blue-600 underline truncate inline-block max-w-[300px]">
                    {value}
                  </a>
                ),
              },
              { header: 'Description', accessor: 'description' as const },
              {
                header: 'Action',
                accessor: 'id' as const,
                render: (value: string) => (
                  <button
                    className="text-red-600"
                    onClick={() => void persistPromotions(promotions.filter((r) => r.id !== value))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ),
              },
            ]}
            data={promotions}
          />
        </div>
      )}

      {/* ------------------------------------------------------------------ */
        /* SMS Config (inside General Config)                                 */
        /* ------------------------------------------------------------------ */}
      {activeTab === 'sms' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <p className="text-xs text-gray-500">
            These toggles drive the per-event filter in{' '}
            <code>backend/notifications.service.ts</code>. When an event is OFF, the backend
            silently skips that SMS even if a phone number is present and the provider is wired.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {SMS_EVENT_OPTIONS.map((opt) => (
              <label key={opt.code} className="flex items-center justify-between border rounded-md p-3">
                <div>
                  <div className="text-sm font-medium text-gray-800">{opt.label}</div>
                  <div className="text-xs text-gray-500 font-mono">{opt.code}</div>
                </div>
                <input
                  type="checkbox"
                  checked={enabledSms.has(opt.code)}
                  onChange={() => toggleSmsEvent(opt.code)}
                />
              </label>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              type="number"
              label="Max Win Limit for SMS (ETB) — only notify if win >="
              value={String(general.sms_max_win_limit ?? 0)}
              onChange={(v) => setGeneral((p) => ({ ...p, sms_max_win_limit: Number(v || 0) }))}
              placeholder="0 = always notify"
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={(e) => void saveGeneral(e as unknown as React.FormEvent)}
              disabled={saving}
              className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save SMS Config'}
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */
        /* Cashier Config                                                     */
        /* ------------------------------------------------------------------ */}
      {activeTab === 'cashier' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <p className="text-xs text-gray-500">
            Enforced inside the cashier service when sales agents cancel tickets or request
            withdrawals.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              type="number"
              label="Max Daily Cancel Volume (ETB)"
              value={String(general.cashier_max_daily_cancel_volume ?? 0)}
              onChange={(v) =>
                setGeneral((p) => ({
                  ...p,
                  cashier_max_daily_cancel_volume: Number(v || 0),
                }))
              }
            />
            <Field
              type="number"
              label="Max Stake Cancel (ETB)"
              value={String(general.cashier_max_stake_cancel ?? 0)}
              onChange={(v) =>
                setGeneral((p) => ({
                  ...p,
                  cashier_max_stake_cancel: Number(v || 0),
                }))
              }
            />
            <Field
              type="number"
              label="Cancel Window (minutes)"
              value={String(general.cashier_cancel_window_minutes ?? 5)}
              onChange={(v) =>
                setGeneral((p) => ({
                  ...p,
                  cashier_cancel_window_minutes: Number(v || 0),
                }))
              }
            />
            <Field
              type="number"
              label="Max Daily Cancel Count"
              value={String(general.cashier_max_daily_cancel_count ?? 0)}
              onChange={(v) =>
                setGeneral((p) => ({
                  ...p,
                  cashier_max_daily_cancel_count: Number(v || 0),
                }))
              }
            />
            <ToggleField
              label="Enable Withdraw Request"
              value={Boolean(general.cashier_enable_withdraw_request)}
              onChange={(v) =>
                setGeneral((p) => ({ ...p, cashier_enable_withdraw_request: v }))
              }
            />
            <ToggleField
              label="Enable Duplicate Slip"
              value={Boolean(general.cashier_enable_duplicate_slip)}
              onChange={(v) =>
                setGeneral((p) => ({ ...p, cashier_enable_duplicate_slip: v }))
              }
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={(e) => void saveGeneral(e as unknown as React.FormEvent)}
              disabled={saving}
              className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save Cashier Config'}
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */
        /* Operation Hours                                                    */
        /* ------------------------------------------------------------------ */}
      {activeTab === 'hours' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <p className="text-xs text-gray-500">
            Bet placement is blocked outside these hours when{' '}
            <em>Enforce on bet placement</em> is on. The user panel reads{' '}
            <code>GET /api/public/operation-hours</code> to show the open/closed badge.
          </p>
          <div className="flex items-center gap-3">
            <ToggleField
              label="Enforce on bet placement"
              value={Boolean(general.operation_hours_enforce_bets)}
              onChange={(v) => setGeneral((p) => ({ ...p, operation_hours_enforce_bets: v }))}
            />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500">
                  <th className="py-2 pr-4">Day</th>
                  <th className="py-2 pr-4">Open</th>
                  <th className="py-2 pr-4">Close</th>
                  <th className="py-2 pr-4">Closed all day</th>
                </tr>
              </thead>
              <tbody>
                {DAYS.map(({ key, label }) => {
                  const day = general.operation_hours?.[key];
                  return (
                    <tr key={key} className="border-t">
                      <td className="py-2 pr-4">{label}</td>
                      <td className="py-2 pr-4">
                        <input
                          type="time"
                          value={day?.open ?? '09:00'}
                          onChange={(e) => updateDayHours(key, { open: e.target.value })}
                          className="rounded-md border-gray-300"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="time"
                          value={day?.close ?? '23:00'}
                          onChange={(e) => updateDayHours(key, { close: e.target.value })}
                          className="rounded-md border-gray-300"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="checkbox"
                          checked={Boolean(day?.closed)}
                          onChange={(e) => updateDayHours(key, { closed: e.target.checked })}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end">
            <button
              onClick={(e) => void saveGeneral(e as unknown as React.FormEvent)}
              disabled={saving}
              className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save Operation Hours'}
            </button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */
        /* Payment Methods (read-only legacy)                                 */
        /* ------------------------------------------------------------------ */}
      {activeTab === 'payment' && (
        <div className="bg-white rounded-lg shadow p-6">
          <DataTable
            columns={[
              { header: 'Method', accessor: 'name' as const },
              { header: 'Channels', accessor: 'channels' as const },
              { header: 'Currencies', accessor: 'currencies' as const },
              { header: 'Status', accessor: 'status' as const },
            ]}
            data={methodRows}
          />
          {loading && <div className="text-sm text-gray-500 mt-4">Loading payment methods…</div>}
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Small UI helpers — kept inline so no extra files are introduced.           */
/* -------------------------------------------------------------------------- */

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="text-sm space-y-1">
      <span className="text-gray-700">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-md border-gray-300"
      />
    </label>
  );
}

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="text-sm flex items-center justify-between gap-3 border rounded-md p-3">
      <span className="text-gray-700">{label}</span>
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="md:col-span-2 pt-3 mt-2 border-t text-sm font-semibold text-gray-700">
      {title}
    </div>
  );
}
