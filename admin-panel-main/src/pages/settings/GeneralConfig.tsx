import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DataTable } from '../../components/DataTable';
import { TabGroup } from '../../components/TabGroup';
import { Settings, Plus, Save, Trash2, Upload } from 'lucide-react';
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

const DEFAULT_NAVBAR_ITEMS: settingsApi.NavbarItem[] = [
  { id: 'nav-home', label: 'Home', href: '/', bucket: 'main', is_active: true, display_order: 0 },
  { id: 'nav-games', label: 'Games', href: '/games', bucket: 'main', is_active: true, display_order: 1 },
  { id: 'nav-aviator', label: 'Aviator', href: '/games?play=aviator', bucket: 'main', is_active: true, display_order: 2 },
  { id: 'nav-jetx', label: 'JetX', href: '/games?play=jetx', bucket: 'main', is_active: true, display_order: 3 },
  { id: 'nav-fast-keno', label: 'Fast Keno', href: '/games?play=fast-keno', bucket: 'main', is_active: true, display_order: 4 },
  { id: 'nav-promotions', label: 'Promotion', href: '/promotions', bucket: 'main', is_active: true, display_order: 5 },
  { id: 'nav-more', label: 'More', href: '/more', bucket: 'more', is_active: true, display_order: 6 },
];

function normalizeNavbarRows(rows: settingsApi.NavbarItem[]): settingsApi.NavbarItem[] {
  return rows.map((item, idx) => ({
    ...item,
    id: item.id || `n-${idx}`,
    label: String(item.label ?? '').trim(),
    href: String(item.href ?? '').trim(),
    bucket: item.bucket === 'more' ? 'more' : 'main',
    is_active: item.is_active !== false,
    display_order: idx,
  }));
}

export function GeneralConfig() {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [activeTab, setActiveTab] = useState('company');
  const [general, setGeneral] = useState<settingsApi.GeneralConfig>(defaultGeneral);
  const [topBets, setTopBets] = useState<settingsApi.TopBetEntry[]>([]);
  const [topMatches, setTopMatches] = useState<settingsApi.TopMatchEntry[]>([]);
  const [promotions, setPromotions] = useState<settingsApi.PromotionBanner[]>([]);
  const [gameThumbnails, setGameThumbnails] = useState<settingsApi.GameThumbnail[]>([]);
  const [footerLinks, setFooterLinks] = useState<settingsApi.FooterLinks>({
    company_description: "Ethiopia's modern sports betting platform. Bet on football, basketball, and more. Fast payouts, secure accounts.",
    live_chat_text: 'Available 24/7',
    support_email: 'support@1birr.bet',
    telegram_link: 'https://t.me/1birr_support',
    show_18_plus_notice: true,
    notice_18_plus_text: '18+ Only',
    copyright_text: '',
    company_links: [
      { name: 'About Us', href: '/about' },
      { name: 'Careers', href: '/about' },
      { name: 'Responsible Gaming', href: '/rules' },
      { name: 'Press', href: '/about' },
    ],
    legal_links: [
      { name: 'Terms & Conditions', href: '/rules' },
      { name: 'Privacy Policy', href: '/privacy' },
      { name: 'Cookies Policy', href: '/cookies' },
      { name: 'Account Rules', href: '/account-rules' },
    ],
    sports_links: [
      { name: 'Football', href: '/' },
      { name: 'Basketball', href: '/' },
      { name: 'Tennis', href: '/' },
      { name: 'Cricket', href: '/' },
      { name: 'Volleyball', href: '/' },
    ],
    social_links: [
      { name: 'Telegram', href: 'https://t.me/1birr_support' },
      { name: 'Facebook', href: '#' },
      { name: 'Instagram', href: '#' },
      { name: 'YouTube', href: '#' },
    ],
  });
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
  const [newPromoCta, setNewPromoCta] = useState('');
  const [newPromoWidth, setNewPromoWidth] = useState('');
  const [newPromoHeight, setNewPromoHeight] = useState('');

  /* Game thumbnails entry form */
  const [newThumbGameId, setNewThumbGameId] = useState('');
  const [newThumbGameName, setNewThumbGameName] = useState('');
  const [newThumbUrl, setNewThumbUrl] = useState('');
  const [newThumbPromoUrl, setNewThumbPromoUrl] = useState('');
  const [navbarItems, setNavbarItems] = useState<settingsApi.NavbarItem[]>([]);
  const [newNavbarLabel, setNewNavbarLabel] = useState('');
  const [newNavbarHref, setNewNavbarHref] = useState('');
  const [newNavbarBucket, setNewNavbarBucket] = useState<'main' | 'more'>('main');
  const [editingNavbarId, setEditingNavbarId] = useState<string | null>(null);

  const load = async () => {
    if (!isAuth) return;
    setLoading(true);
    try {
      const [generalRes, betsRes, matchesRes, promosRes, footerRes, thumbsRes, navbarRes, methodsRes] =
        await Promise.all([
          settingsApi.getGeneralConfig().catch(() => ({} as settingsApi.GeneralConfig)),
          settingsApi.listTopBets().catch(() => ({ items: [] })),
          settingsApi.listTopMatches().catch(() => ({ items: [] })),
          settingsApi.listPromotions().catch(() => ({ items: [] })),
          settingsApi.getFooterLinks().catch(() => null),
          settingsApi.listGameThumbnails().catch(() => ({ items: [] })),
          settingsApi.listNavbarItems().catch(() => ({ items: [] })),
          paymentMethodsApi.listPaymentMethods().catch(() => ({ items: [] })),
        ]);
      setGeneral({ ...defaultGeneral, ...(generalRes ?? {}) });
      setTopBets((betsRes.items ?? []).map((r, i) => ({ ...r, id: r.id || `b-${i}` })));
      setTopMatches(
        (matchesRes.items ?? []).map((r, i) => ({ ...r, id: r.id || `m-${i}` }))
      );
      setPromotions((promosRes.items ?? []).map((r, i) => ({ ...r, id: r.id || `p-${i}` })));
      if (footerRes && typeof footerRes === 'object') {
        // Merge saved values over the defaults (so empty-saved fields keep defaults)
        setFooterLinks((prev) => ({ ...prev, ...footerRes }));
      }
      setGameThumbnails(
        (thumbsRes.items ?? []).map((r, i) => ({ ...r, id: r.id || `t-${i}` }))
      );
      const loadedNavbar = normalizeNavbarRows(navbarRes.items ?? []);
      setNavbarItems(loadedNavbar.length > 0 ? loadedNavbar : DEFAULT_NAVBAR_ITEMS);
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

  const persistFooterLinks = async (data: settingsApi.FooterLinks) => {
    setFooterLinks(data);
    try {
      await settingsApi.saveFooterLinks(data);
      toast('Footer content saved.');
    } catch (err) {
      toast(`Failed to save footer content: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  const persistGameThumbnails = async (rows: settingsApi.GameThumbnail[]) => {
    setGameThumbnails(rows);
    try {
      await settingsApi.saveGameThumbnails(rows);
    } catch (err) {
      toast(`Failed to save game thumbnails: ${(err as Error)?.message ?? err}`, 'error');
    }
  };

  const persistNavbarItems = async (rows: settingsApi.NavbarItem[]) => {
    const previous = navbarItems;
    const normalized = normalizeNavbarRows(rows);
    setNavbarItems(normalized);
    try {
      const saved = await settingsApi.saveNavbarItems(normalized);
      setNavbarItems((saved.items ?? normalized).map((item, idx) => ({
        ...item,
        id: item.id || `n-${idx}`,
      })));
      toast('Navbar settings saved.');
    } catch (err) {
      setNavbarItems(previous);
      toast(`Failed to save navbar settings: ${(err as Error)?.message ?? err}`, 'error');
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
    { id: 'header-banner', label: 'Header & Banner Settings' },
    { id: 'footer-settings', label: 'Footer Settings' },
    { id: 'navbar-settings', label: 'Navbar Settings' },
    { id: 'game-thumbnails', label: 'Game Thumbnails' },
    { id: 'top-bets', label: 'Top Bets' },
    { id: 'top-matches', label: 'Top Matches' },
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
            <Field label="Platform name" value={general.platform_name ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, platform_name: v }))} placeholder="1birr.bet" />
            <Field label="Currency" value={general.currency ?? 'ETB'} onChange={(v) => setGeneral((p) => ({ ...p, currency: v }))} placeholder="ETB" />
            <Field label="Country" value={general.country ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, country: v }))} placeholder="Ethiopia" />
            <Field label="Country code" value={general.country_code ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, country_code: v }))} placeholder="ET" />
            <Field label="Website URL" value={general.website_url ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, website_url: v }))} placeholder="https://1birr.bet" />
            <ImageUploadField label="Logo" value={general.logo_url ?? ''} onChange={(v) => setGeneral((p) => ({ ...p, logo_url: v }))} placeholder="https://cdn.example.com/logo.png" />
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

            <SectionHeader title="Website Content" />
            <label className="md:col-span-2 space-y-1">
              <span className="text-gray-700">Terms &amp; Conditions</span>
              <textarea
                rows={8}
                value={general.terms_and_conditions ?? ''}
                onChange={(e) => setGeneral((p) => ({ ...p, terms_and_conditions: e.target.value }))}
                className="w-full rounded-md border-gray-300"
                placeholder="Full terms & conditions text shown on the user panel (Terms page and Promotions page)."
              />
            </label>
            <label className="md:col-span-2 space-y-1">
              <span className="text-gray-700">Footer Content</span>
              <textarea
                rows={3}
                value={general.footer_text ?? ''}
                onChange={(e) => setGeneral((p) => ({ ...p, footer_text: e.target.value }))}
                className="w-full rounded-md border-gray-300"
                placeholder="Short description rendered in the user-panel footer."
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

      {activeTab === 'footer-settings' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-5">
          <h3 className="text-base font-semibold text-gray-800">Footer Settings</h3>
          <p className="text-xs text-gray-500">
            These fields are based on the current footer structure used on the user panel.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <label className="space-y-1">
              <span className="text-gray-700 font-medium">Company Description</span>
              <textarea
                rows={2}
                value={footerLinks.company_description ?? ''}
                onChange={(e) => setFooterLinks((p) => ({ ...p, company_description: e.target.value }))}
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <div className="space-y-3">
              <label className="block space-y-1">
                <span className="text-gray-700 font-medium">Email Support</span>
                <input
                  type="email"
                  value={footerLinks.support_email ?? ''}
                  onChange={(e) => setFooterLinks((p) => ({ ...p, support_email: e.target.value }))}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                  placeholder="support@1birr.bet"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-gray-700 font-medium">Telegram Support</span>
                <input
                  type="text"
                  value={footerLinks.telegram_link ?? ''}
                  onChange={(e) => setFooterLinks((p) => ({ ...p, telegram_link: e.target.value }))}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                  placeholder="https://t.me/1birr_support"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-gray-700 font-medium">Live Chat Text</span>
                <input
                  type="text"
                  value={footerLinks.live_chat_text ?? ''}
                  onChange={(e) => setFooterLinks((p) => ({ ...p, live_chat_text: e.target.value }))}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-gray-700 font-medium">Copyright Text</span>
                <input
                  type="text"
                  value={footerLinks.copyright_text ?? ''}
                  onChange={(e) => setFooterLinks((p) => ({ ...p, copyright_text: e.target.value }))}
                  className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                />
              </label>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <label className="block space-y-1">
              <span className="text-gray-700 font-medium">18+ Notice Text</span>
              <input
                type="text"
                value={footerLinks.notice_18_plus_text ?? ''}
                onChange={(e) => setFooterLinks((p) => ({ ...p, notice_18_plus_text: e.target.value }))}
                className="w-full rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
                placeholder="18+ Only"
              />
            </label>
            <ToggleField
              label="Show 18+ Notice Badge"
              value={footerLinks.show_18_plus_notice !== false}
              onChange={(v) => setFooterLinks((p) => ({ ...p, show_18_plus_notice: v }))}
            />
          </div>
          <FooterLinkEditor
            label="Follow Us Links (Social Media Links)"
            items={(footerLinks.social_links ?? []) as settingsApi.FooterLinkItem[]}
            onChange={(items) => setFooterLinks((p) => ({ ...p, social_links: items }))}
          />
          {(
            [
              { key: 'company_links', label: 'Company Links' },
              { key: 'legal_links', label: 'Legal Links' },
              { key: 'sports_links', label: 'Sports Links' },
            ] as const
          ).map(({ key, label }) => (
            <FooterLinkEditor
              key={key}
              label={label}
              items={(footerLinks[key] ?? []) as settingsApi.FooterLinkItem[]}
              onChange={(items) => setFooterLinks((p) => ({ ...p, [key]: items }))}
            />
          ))}
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void persistFooterLinks(footerLinks)}
              className="inline-flex items-center px-4 py-2 rounded-md bg-green-600 text-white"
            >
              <Save className="h-4 w-4 mr-2" /> Save Footer Settings
            </button>
          </div>
        </div>
      )}

      {activeTab === 'navbar-settings' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-base font-semibold text-gray-800">Navbar Settings</h3>
          <p className="text-xs text-gray-500">
            Manage main and more navigation items dynamically without changing the existing navbar layout.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <input value={newNavbarLabel} onChange={(e) => setNewNavbarLabel(e.target.value)} placeholder="Menu name" className="rounded-md border-gray-300" />
            <input value={newNavbarHref} onChange={(e) => setNewNavbarHref(e.target.value)} placeholder="Link (e.g. /games)" className="rounded-md border-gray-300" />
            <select value={newNavbarBucket} onChange={(e) => setNewNavbarBucket(e.target.value as 'main' | 'more')} className="rounded-md border-gray-300">
              <option value="main">Main Nav</option>
              <option value="more">More Menu</option>
            </select>
            <button
              onClick={() => {
                if (!newNavbarLabel.trim() || !newNavbarHref.trim()) return;
                if (editingNavbarId) {
                  void persistNavbarItems(
                    navbarItems.map((item) =>
                      item.id === editingNavbarId
                        ? {
                            ...item,
                            label: newNavbarLabel.trim(),
                            href: newNavbarHref.trim(),
                            bucket: newNavbarBucket,
                          }
                        : item
                    )
                  );
                } else {
                  void persistNavbarItems([
                    ...navbarItems,
                    {
                      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      label: newNavbarLabel.trim(),
                      href: newNavbarHref.trim(),
                      bucket: newNavbarBucket,
                      is_active: true,
                      display_order: navbarItems.length,
                    },
                  ]);
                }
                setEditingNavbarId(null);
                setNewNavbarLabel('');
                setNewNavbarHref('');
              }}
              className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-blue-600 text-white"
            >
              <Plus className="h-4 w-4 mr-1" /> {editingNavbarId ? 'Update' : 'Add'}
            </button>
            {editingNavbarId && (
              <button
                type="button"
                className="inline-flex items-center justify-center px-4 py-2 rounded-md border border-gray-300 text-gray-700"
                onClick={() => {
                  setEditingNavbarId(null);
                  setNewNavbarLabel('');
                  setNewNavbarHref('');
                  setNewNavbarBucket('main');
                }}
              >
                Cancel
              </button>
            )}
          </div>
          <DataTable
            columns={[
              { header: 'Name', accessor: 'label' as const },
              { header: 'Link', accessor: 'href' as const },
              { header: 'Bucket', accessor: 'bucket' as const },
              {
                header: 'Enabled',
                accessor: 'is_active' as const,
                render: (value: boolean, row: settingsApi.NavbarItem) => (
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) => void persistNavbarItems(navbarItems.map((i) => i.id === row.id ? { ...i, is_active: e.target.checked } : i))}
                  />
                ),
              },
              {
                header: 'Order',
                accessor: 'display_order' as const,
                render: (_v, row: settingsApi.NavbarItem) => (
                  <div className="flex gap-2">
                    <button
                      className="text-xs px-2 py-1 border rounded"
                      onClick={() => {
                        const idx = navbarItems.findIndex((x) => x.id === row.id);
                        if (idx <= 0) return;
                        const copy = [...navbarItems];
                        [copy[idx - 1], copy[idx]] = [copy[idx], copy[idx - 1]];
                        void persistNavbarItems(copy.map((x, i) => ({ ...x, display_order: i })));
                      }}
                    >
                      Up
                    </button>
                    <button
                      className="text-xs px-2 py-1 border rounded"
                      onClick={() => {
                        const idx = navbarItems.findIndex((x) => x.id === row.id);
                        if (idx < 0 || idx >= navbarItems.length - 1) return;
                        const copy = [...navbarItems];
                        [copy[idx], copy[idx + 1]] = [copy[idx + 1], copy[idx]];
                        void persistNavbarItems(copy.map((x, i) => ({ ...x, display_order: i })));
                      }}
                    >
                      Down
                    </button>
                  </div>
                ),
              },
              {
                header: 'Action',
                accessor: 'id' as const,
                render: (value: string) => (
                  <div className="flex items-center gap-2">
                    <button
                      className="text-blue-600 text-xs px-2 py-1 border rounded"
                      onClick={() => {
                        const target = navbarItems.find((n) => n.id === value);
                        if (!target) return;
                        setEditingNavbarId(target.id || null);
                        setNewNavbarLabel(target.label || '');
                        setNewNavbarHref(target.href || '');
                        setNewNavbarBucket(target.bucket === 'more' ? 'more' : 'main');
                      }}
                    >
                      Edit
                    </button>
                    <button className="text-red-600" onClick={() => void persistNavbarItems(navbarItems.filter((n) => n.id !== value))}>
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ),
              },
            ]}
            data={navbarItems}
          />
        </div>
      )}

      {/* Banner Slider tab removed — use existing Promotions tab instead */}
      {activeTab === 'banners-removed' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <p className="text-xs text-gray-500">
            These banners feed the homepage slider on the user panel. Changes take effect
            immediately. Each banner needs a title and an image URL. Enable/disable individual
            banners without deleting them. Saved to{' '}
            <code>POST /api/admin/settings/promotions</code> (same key as Promotions page).
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={newPromoTitle}
              onChange={(e) => setNewPromoTitle(e.target.value)}
              placeholder="Banner title (e.g. WIN UP TO 360,000)"
              className="rounded-md border-gray-300"
            />
            <input
              value={newPromoImage}
              onChange={(e) => setNewPromoImage(e.target.value)}
              placeholder="Image URL (desktop/mobile)"
              className="rounded-md border-gray-300"
            />
            <input
              value={newPromoCta}
              onChange={(e) => setNewPromoCta(e.target.value)}
              placeholder="CTA URL (optional, e.g. /games)"
              className="rounded-md border-gray-300"
            />
            <input
              value={newPromoBonus}
              onChange={(e) => setNewPromoBonus(e.target.value)}
              placeholder="Bonus type (optional)"
              className="rounded-md border-gray-300"
            />
          </div>
          <label className="block">
            <span className="text-xs text-gray-600">Description (optional)</span>
            <textarea
              rows={2}
              value={newPromoDesc}
              onChange={(e) => setNewPromoDesc(e.target.value)}
              className="w-full rounded-md border-gray-300"
              placeholder="Short description shown below the banner title"
            />
          </label>
          <button
            onClick={() => {
              if (!newPromoTitle.trim() || !newPromoImage.trim()) return;
              void persistPromotions([
                ...promotions,
                {
                  id: String(Date.now()),
                  title: newPromoTitle.trim(),
                  image_url: newPromoImage.trim(),
                  bonus_type: newPromoBonus.trim() || undefined,
                  description: newPromoDesc.trim() || undefined,
                  cta_url: newPromoCta.trim() || undefined,
                  is_active: true,
                  display_order: promotions.length,
                },
              ]);
              setNewPromoTitle('');
              setNewPromoImage('');
              setNewPromoBonus('');
              setNewPromoDesc('');
              setNewPromoCta('');
            }}
            className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Banner
          </button>
          <DataTable
            columns={[
              { header: 'Title', accessor: 'title' as const },
              {
                header: 'Image',
                accessor: 'image_url' as const,
                render: (value: string) => (
                  <img src={value} alt="" className="h-10 w-20 object-cover rounded" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ),
              },
              { header: 'Description', accessor: 'description' as const },
              {
                header: 'Active',
                accessor: 'is_active' as const,
                render: (value: boolean, row: settingsApi.PromotionBanner) => (
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) =>
                      void persistPromotions(
                        promotions.map((p) =>
                          p.id === row.id ? { ...p, is_active: e.target.checked } : p
                        )
                      )
                    }
                  />
                ),
              },
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
        /* Game Thumbnails                                                    */
        /* ------------------------------------------------------------------ */}
      {activeTab === 'game-thumbnails' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <p className="text-xs text-gray-500">
            Override the default thumbnail shown for any game in the user panel lobby.
            Enter the <em>game_id</em> (e.g. <code>aviator</code>, <code>fast-keno</code>) and
            a custom image URL. Saved to{' '}
            <code>POST /api/admin/settings/game-thumbnails</code> and consumed immediately
            by the user panel Games page.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              value={newThumbGameId}
              onChange={(e) => setNewThumbGameId(e.target.value)}
              placeholder="Game ID (e.g. aviator, fast-keno, jetx)"
              className="rounded-md border-gray-300"
            />
            <input
              value={newThumbGameName}
              onChange={(e) => setNewThumbGameName(e.target.value)}
              placeholder="Game name (display label)"
              className="rounded-md border-gray-300"
            />
          </div>
          <ImageUploadField
            label="Thumbnail Image"
            value={newThumbUrl}
            onChange={setNewThumbUrl}
            placeholder="Upload a local image or paste a URL"
          />
          <ImageUploadField
            label="Promo / Banner Image (optional)"
            value={newThumbPromoUrl}
            onChange={setNewThumbPromoUrl}
            placeholder="Upload a local image or paste a URL"
          />
          <button
            onClick={() => {
              if (!newThumbGameId.trim() || !newThumbUrl.trim()) return;
              void persistGameThumbnails([
                ...gameThumbnails,
                {
                  id: String(Date.now()),
                  game_id: newThumbGameId.trim(),
                  game_name: newThumbGameName.trim() || newThumbGameId.trim(),
                  thumbnail_url: newThumbUrl.trim(),
                  promo_url: newThumbPromoUrl.trim() || undefined,
                  is_active: true,
                  display_order: gameThumbnails.length,
                },
              ]);
              setNewThumbGameId('');
              setNewThumbGameName('');
              setNewThumbUrl('');
              setNewThumbPromoUrl('');
            }}
            className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Thumbnail
          </button>
          <DataTable
            columns={[
              { header: 'Game ID', accessor: 'game_id' as const },
              { header: 'Name', accessor: 'game_name' as const },
              {
                header: 'Thumbnail',
                accessor: 'thumbnail_url' as const,
                render: (value: string) => (
                  <img src={value} alt="" className="h-10 w-16 object-cover rounded" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                ),
              },
              {
                header: 'Active',
                accessor: 'is_active' as const,
                render: (value: boolean, row: settingsApi.GameThumbnail) => (
                  <input
                    type="checkbox"
                    checked={Boolean(value)}
                    onChange={(e) =>
                      void persistGameThumbnails(
                        gameThumbnails.map((t) =>
                          t.id === row.id ? { ...t, is_active: e.target.checked } : t
                        )
                      )
                    }
                  />
                ),
              },
              {
                header: 'Action',
                accessor: 'id' as const,
                render: (value: string) => (
                  <button
                    className="text-red-600"
                    onClick={() => void persistGameThumbnails(gameThumbnails.filter((r) => r.id !== value))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                ),
              },
            ]}
            data={gameThumbnails}
          />
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
      {activeTab === 'header-banner' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
          <h3 className="text-base font-semibold text-gray-800">Header & Banner Settings</h3>
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
            <strong>Upload Guidance:</strong> use optimized images to keep loading fast and storage small.
            Recommended dimensions, max size, and formats are shown under each upload field.
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ImageUploadField
              label="Header Logo"
              value={general.header_logo_url ?? general.logo_url ?? ''}
              onChange={(v) => setGeneral((p) => ({ ...p, header_logo_url: v }))}
              placeholder="Upload header logo"
              recommendedWidth={220}
              recommendedHeight={64}
              maxFileSizeMb={2}
              supportedFormats="PNG, SVG, WEBP, JPG"
            />
            <ImageUploadField
              label="Footer Logo"
              value={general.footer_logo_url ?? general.logo_url ?? ''}
              onChange={(v) => setGeneral((p) => ({ ...p, footer_logo_url: v }))}
              placeholder="Upload footer logo"
              recommendedWidth={220}
              recommendedHeight={64}
              maxFileSizeMb={2}
              supportedFormats="PNG, SVG, WEBP, JPG"
            />
            <Field
              type="number"
              label="Header Logo Width"
              value={String(general.logo_width ?? 0)}
              onChange={(v) => setGeneral((p) => ({ ...p, logo_width: Number(v || 0) }))}
            />
            <Field
              type="number"
              label="Header Logo Height"
              value={String(general.logo_height ?? 0)}
              onChange={(v) => setGeneral((p) => ({ ...p, logo_height: Number(v || 0) }))}
            />
            <Field
              type="number"
              label="Footer Logo Width"
              value={String(general.footer_logo_width ?? 0)}
              onChange={(v) => setGeneral((p) => ({ ...p, footer_logo_width: Number(v || 0) }))}
            />
            <Field
              type="number"
              label="Footer Logo Height"
              value={String(general.footer_logo_height ?? 0)}
              onChange={(v) => setGeneral((p) => ({ ...p, footer_logo_height: Number(v || 0) }))}
            />
          </div>
          <div className="border-t pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
            <ImageUploadField
              label="Static Banner Image"
              value={general.static_banner_image_url ?? ''}
              onChange={(v) => setGeneral((p) => ({ ...p, static_banner_image_url: v }))}
              placeholder="Upload static fallback banner"
              recommendedWidth={1440}
              recommendedHeight={360}
              maxFileSizeMb={3}
              supportedFormats="WEBP, JPG, PNG"
            />
            <ImageUploadField
              label="Static Banner Mobile Image"
              value={general.static_banner_mobile_image_url ?? ''}
              onChange={(v) => setGeneral((p) => ({ ...p, static_banner_mobile_image_url: v }))}
              placeholder="Optional mobile static banner"
              recommendedWidth={900}
              recommendedHeight={360}
              maxFileSizeMb={3}
              supportedFormats="WEBP, JPG, PNG"
            />
            <Field
              label="Static Banner Title"
              value={general.static_banner_title ?? ''}
              onChange={(v) => setGeneral((p) => ({ ...p, static_banner_title: v }))}
            />
            <Field
              label="Static Banner Subtitle"
              value={general.static_banner_subtitle ?? ''}
              onChange={(v) => setGeneral((p) => ({ ...p, static_banner_subtitle: v }))}
            />
            <Field
              type="number"
              label="Static Banner Width"
              value={String(general.static_banner_width ?? 0)}
              onChange={(v) => setGeneral((p) => ({ ...p, static_banner_width: Number(v || 0) }))}
            />
            <Field
              type="number"
              label="Static Banner Height"
              value={String(general.static_banner_height ?? 0)}
              onChange={(v) => setGeneral((p) => ({ ...p, static_banner_height: Number(v || 0) }))}
            />
            <Field
              type="number"
              label="Slider Banner Width"
              value={String(general.slider_banner_width ?? 0)}
              onChange={(v) => setGeneral((p) => ({ ...p, slider_banner_width: Number(v || 0) }))}
            />
            <Field
              type="number"
              label="Slider Banner Height"
              value={String(general.slider_banner_height ?? 0)}
              onChange={(v) => setGeneral((p) => ({ ...p, slider_banner_height: Number(v || 0) }))}
            />
          </div>
          <div className="flex justify-end">
            <button
              onClick={(e) => void saveGeneral(e as unknown as React.FormEvent)}
              disabled={saving}
              className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
            >
              <Save className="h-4 w-4 mr-2" />
              {saving ? 'Saving...' : 'Save Header & Banner Settings'}
            </button>
          </div>
          <p className="text-xs text-gray-500">
            Saved to <code>POST /api/admin/settings/promotions</code>. These banners feed the
            homepage banner slider and the promotions page on the user panel.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input value={newPromoTitle} onChange={(e) => setNewPromoTitle(e.target.value)} placeholder="Title (e.g. WIN UP TO 360,000)" className="rounded-md border-gray-300" />
            <input value={newPromoBonus} onChange={(e) => setNewPromoBonus(e.target.value)} placeholder="Bonus type (optional)" className="rounded-md border-gray-300" />
          </div>
          <ImageUploadField
            label="Banner Image"
            value={newPromoImage}
            onChange={setNewPromoImage}
            placeholder="Upload a local image or paste a URL"
            recommendedWidth={1440}
            recommendedHeight={360}
            maxFileSizeMb={3}
            supportedFormats="WEBP, JPG, PNG"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input value={newPromoCta} onChange={(e) => setNewPromoCta(e.target.value)} placeholder="CTA URL (optional, e.g. /games)" className="rounded-md border-gray-300" />
            <div className="grid grid-cols-2 gap-2">
              <input value={newPromoWidth} onChange={(e) => setNewPromoWidth(e.target.value)} placeholder="Width" className="rounded-md border-gray-300" />
              <input value={newPromoHeight} onChange={(e) => setNewPromoHeight(e.target.value)} placeholder="Height" className="rounded-md border-gray-300" />
            </div>
          </div>
          <label className="block">
            <span className="text-xs text-gray-600">Description (optional)</span>
            <textarea
              rows={2}
              value={newPromoDesc}
              onChange={(e) => setNewPromoDesc(e.target.value)}
              className="w-full rounded-md border-gray-300"
              placeholder="Short description shown below the banner title"
            />
          </label>
          <button
            onClick={() => {
              if (!newPromoTitle.trim() || !newPromoImage.trim()) return;
              void persistPromotions([
                ...promotions,
                {
                  id: String(Date.now()),
                  title: newPromoTitle.trim(),
                  image_url: newPromoImage.trim(),
                  bonus_type: newPromoBonus.trim() || undefined,
                  description: newPromoDesc.trim() || undefined,
                  cta_url: newPromoCta.trim() || undefined,
                  image_width: Number(newPromoWidth || 0) || undefined,
                  image_height: Number(newPromoHeight || 0) || undefined,
                  is_active: true,
                  display_order: promotions.length,
                },
              ]);
              setNewPromoTitle('');
              setNewPromoBonus('');
              setNewPromoImage('');
              setNewPromoDesc('');
              setNewPromoCta('');
              setNewPromoWidth('');
              setNewPromoHeight('');
            }}
            className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white"
          >
            <Plus className="h-4 w-4 mr-2" /> Add Banner
          </button>
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

/**
 * FooterLinkEditor — inline CRUD for a single group of footer links
 * (company_links / legal_links / sports_links).
 */
function FooterLinkEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: settingsApi.FooterLinkItem[];
  onChange: (items: settingsApi.FooterLinkItem[]) => void;
}) {
  const [newName, setNewName] = useState('');
  const [newHref, setNewHref] = useState('');

  const add = () => {
    if (!newName.trim() || !newHref.trim()) return;
    onChange([...items, { name: newName.trim(), href: newHref.trim() }]);
    setNewName('');
    setNewHref('');
  };

  return (
    <div className="text-sm space-y-2">
      <span className="font-medium text-gray-700">{label}</span>
      <div className="space-y-1 max-h-48 overflow-y-auto border rounded-md p-2">
        {items.length === 0 && (
          <p className="text-xs text-gray-400 italic">No links — using site defaults.</p>
        )}
        {items.map((link, idx) => (
          <div key={idx} className="flex items-center gap-2 text-xs">
            <span className="flex-1 font-medium truncate">{link.name}</span>
            <span className="text-gray-500 truncate max-w-[200px]">{link.href}</span>
            <button
              type="button"
              className="text-red-500 hover:text-red-700"
              onClick={() => onChange(items.filter((_, i) => i !== idx))}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Link name (e.g. About Us)"
            className="flex-1 min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <input
            type="text"
            value={newHref}
            onChange={(e) => setNewHref(e.target.value)}
            placeholder="/page or https://..."
            className="flex-1 min-w-0 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          />
        </div>
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium"
        >
          <Plus className="h-3 w-3" /> Add Link
        </button>
      </div>
    </div>
  );
}

/**
 * ImageUploadField — text input + "Upload" button that converts a locally
 * chosen file to a base64 data URL and stores it in the bound value.
 * Accepts any URL string too (paste a https:// URL directly).
 * Shows a small live preview when a value is present.
 */
function ImageUploadField({
  label,
  value,
  onChange,
  placeholder,
  recommendedWidth,
  recommendedHeight,
  maxFileSizeMb,
  supportedFormats,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  recommendedWidth?: number;
  recommendedHeight?: number;
  maxFileSizeMb?: number;
  supportedFormats?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (maxFileSizeMb && file.size > maxFileSizeMb * 1024 * 1024) {
      toast(`"${label}" file is too large. Max size is ${maxFileSizeMb} MB.`, 'error');
      e.target.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === 'string') onChange(result);
    };
    reader.readAsDataURL(file);
    // Reset so selecting the same file again still fires onChange
    e.target.value = '';
  };

  return (
    <div className="text-sm space-y-1">
      <span className="text-gray-700 block">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={value.startsWith('data:') ? '(uploaded image)' : value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'https://... or click Upload to pick a file'}
          className="flex-1 min-w-0 rounded-md border-gray-300"
          readOnly={value.startsWith('data:')}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border bg-gray-50 hover:bg-gray-100 text-xs font-medium text-gray-700"
        >
          <Upload className="h-3.5 w-3.5" /> Upload
        </button>
        {value && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="shrink-0 text-xs text-red-500 hover:text-red-700"
            title="Remove image"
          >
            ✕
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
      {value && (
        <img
          src={value}
          alt="Preview"
          className="mt-1 h-14 w-auto max-w-[200px] rounded border object-contain bg-gray-50"
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      )}
      {(recommendedWidth || recommendedHeight || maxFileSizeMb || supportedFormats) && (
        <p className="text-[11px] text-gray-500">
          Recommended: {recommendedWidth ?? '-'}x{recommendedHeight ?? '-'} px • Max size: {maxFileSizeMb ?? '-'} MB • Formats: {supportedFormats ?? 'JPG, PNG, WEBP'}
        </p>
      )}
    </div>
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
