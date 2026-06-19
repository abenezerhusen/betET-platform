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

  /* Game thumbnails entry form */
  const [newThumbGameId, setNewThumbGameId] = useState('');
  const [newThumbGameName, setNewThumbGameName] = useState('');
  const [newThumbUrl, setNewThumbUrl] = useState('');
  const [newThumbPromoUrl, setNewThumbPromoUrl] = useState('');

  const load = async () => {
    if (!isAuth) return;
    setLoading(true);
    try {
      const [generalRes, betsRes, matchesRes, promosRes, footerRes, thumbsRes, methodsRes] =
        await Promise.all([
          settingsApi.getGeneralConfig().catch(() => ({} as settingsApi.GeneralConfig)),
          settingsApi.listTopBets().catch(() => ({ items: [] })),
          settingsApi.listTopMatches().catch(() => ({ items: [] })),
          settingsApi.listPromotions().catch(() => ({ items: [] })),
          settingsApi.getFooterLinks().catch(() => null),
          settingsApi.listGameThumbnails().catch(() => ({ items: [] })),
          paymentMethodsApi.listPaymentMethods(),
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
    { id: 'game-thumbnails', label: 'Game Thumbnails' },
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

          {/* ---- Footer Links -------------------------------------------- */}
          <div className="mt-8 border-t pt-6 space-y-5">
            <h3 className="font-semibold text-gray-800">Footer Content Management</h3>
            <p className="text-xs text-gray-500">
              Control everything shown in the user-panel footer. Saved immediately to
              <code> /api/admin/settings/footer-links</code>. Changes appear on the user panel when
              the browser tab is re-focused.
            </p>

            {/* Texts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <label className="space-y-1">
                <span className="text-gray-700 font-medium">Company Description</span>
                <textarea
                  rows={2}
                  value={footerLinks.company_description ?? ''}
                  onChange={(e) => setFooterLinks((p) => ({ ...p, company_description: e.target.value }))}
                  className="w-full rounded-md border-gray-300"
                  placeholder="Short tagline shown in the footer"
                />
              </label>
              <div className="space-y-3">
                <label className="block space-y-1">
                  <span className="text-gray-700 font-medium">Live Chat Text</span>
                  <input
                    type="text"
                    value={footerLinks.live_chat_text ?? ''}
                    onChange={(e) => setFooterLinks((p) => ({ ...p, live_chat_text: e.target.value }))}
                    className="w-full rounded-md border-gray-300"
                    placeholder="Available 24/7"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-gray-700 font-medium">Copyright Text</span>
                  <input
                    type="text"
                    value={footerLinks.copyright_text ?? ''}
                    onChange={(e) => setFooterLinks((p) => ({ ...p, copyright_text: e.target.value }))}
                    className="w-full rounded-md border-gray-300"
                    placeholder={`© ${new Date().getFullYear()} 1birr.bet. All rights reserved.`}
                  />
                </label>
              </div>
            </div>

            {/* Link groups */}
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
                <Save className="h-4 w-4 mr-2" /> Save Footer Content
              </button>
            </div>
          </div>
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

      {/* Footer Links tab removed — use Company Info footer_text field instead */}
      {activeTab === 'footer-links-removed' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-6">
          <p className="text-xs text-gray-500">
            Manage the link columns shown in the user panel footer. Changes are saved to{' '}
            <code>PUT /api/admin/settings/footer-links</code> and rendered live on the user panel.
            The <em>Footer Content</em> text (company description) is set in Company Info above.
          </p>

          {/* Copyright + description */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-1 text-sm">
              <span className="text-gray-700">Copyright Text</span>
              <input
                value={footerLinks.copyright_text ?? ''}
                onChange={(e) => setFooterLinks((p) => ({ ...p, copyright_text: e.target.value }))}
                placeholder="© 2026 1birr.bet. All rights reserved."
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-gray-700">Live Chat Info</span>
              <input
                value={footerLinks.live_chat_text ?? ''}
                onChange={(e) => setFooterLinks((p) => ({ ...p, live_chat_text: e.target.value }))}
                placeholder="Available 24/7"
                className="w-full rounded-md border-gray-300"
              />
            </label>
            <label className="md:col-span-2 space-y-1 text-sm">
              <span className="text-gray-700">Company Description (footer)</span>
              <textarea
                rows={3}
                value={footerLinks.company_description ?? ''}
                onChange={(e) => setFooterLinks((p) => ({ ...p, company_description: e.target.value }))}
                placeholder="Ethiopia's modern sports betting platform..."
                className="w-full rounded-md border-gray-300"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => void persistFooterLinks(footerLinks)}
              disabled={saving}
              className="inline-flex items-center px-4 py-2 rounded-md bg-blue-600 text-white disabled:bg-gray-300"
            >
              <Save className="h-4 w-4 mr-2" /> Save Text
            </button>
          </div>

          {/* Add link */}
          <div className="border-t pt-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Manage Footer Links</h3>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <select
                value={newFooterLinkSection}
                onChange={(e) => setNewFooterLinkSection(e.target.value as typeof newFooterLinkSection)}
                className="rounded-md border-gray-300"
              >
                <option value="company_links">Company Links</option>
                <option value="legal_links">Legal Links</option>
                <option value="sports_links">Sports Links</option>
              </select>
              <input
                value={newFooterLinkName}
                onChange={(e) => setNewFooterLinkName(e.target.value)}
                placeholder="Link name (e.g. About Us)"
                className="rounded-md border-gray-300"
              />
              <input
                value={newFooterLinkHref}
                onChange={(e) => setNewFooterLinkHref(e.target.value)}
                placeholder="URL (e.g. /about)"
                className="rounded-md border-gray-300"
              />
              <button
                onClick={() => {
                  if (!newFooterLinkName.trim() || !newFooterLinkHref.trim()) return;
                  const newLink = { name: newFooterLinkName.trim(), href: newFooterLinkHref.trim() };
                  const updated = {
                    ...footerLinks,
                    [newFooterLinkSection]: [
                      ...(footerLinks[newFooterLinkSection] ?? []),
                      newLink,
                    ],
                  };
                  void persistFooterLinks(updated);
                  setNewFooterLinkName('');
                  setNewFooterLinkHref('');
                }}
                className="inline-flex items-center justify-center px-4 py-2 rounded-md bg-blue-600 text-white"
              >
                <Plus className="h-4 w-4 mr-2" /> Add Link
              </button>
            </div>
          </div>

          {/* Current links per section */}
          {(['company_links', 'legal_links', 'sports_links'] as const).map((section) => {
            const items = footerLinks[section] ?? [];
            const label = { company_links: 'Company Links', legal_links: 'Legal Links', sports_links: 'Sports Links' }[section];
            return (
              <div key={section}>
                <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">{label}</h4>
                {items.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No links configured — using site defaults.</p>
                ) : (
                  <div className="space-y-1">
                    {items.map((link, idx) => (
                      <div key={idx} className="flex items-center gap-3 text-sm border rounded-md px-3 py-1.5">
                        <span className="h-3.5 w-3.5 text-gray-400 shrink-0">🔗</span>
                        <span className="flex-1 font-medium">{link.name}</span>
                        <span className="text-gray-500 text-xs">{link.href}</span>
                        <button
                          className="text-red-500"
                          onClick={() => {
                            const updated = {
                              ...footerLinks,
                              [section]: items.filter((_, i) => i !== idx),
                            };
                            void persistFooterLinks(updated);
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
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
      {activeTab === 'promotions' && (
        <div className="bg-white rounded-lg shadow p-6 space-y-4">
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
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input value={newPromoCta} onChange={(e) => setNewPromoCta(e.target.value)} placeholder="CTA URL (optional, e.g. /games)" className="rounded-md border-gray-300" />
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
              setNewPromoBonus('');
              setNewPromoImage('');
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
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Link name"
          className="flex-1 min-w-0 rounded-md border-gray-300 text-xs"
        />
        <input
          type="text"
          value={newHref}
          onChange={(e) => setNewHref(e.target.value)}
          placeholder="/page or https://..."
          className="flex-1 min-w-0 rounded-md border-gray-300 text-xs"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <button
          type="button"
          onClick={add}
          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600 text-white text-xs"
        >
          <Plus className="h-3 w-3" /> Add
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
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
