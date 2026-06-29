"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Gift, Trophy, Ticket, X } from "lucide-react";
import { promotionsApi, publicConfigApi, jackpotsApi } from "@/lib/api";
import type { PublicJackpot } from "@/lib/api/jackpots";

type PromoView = {
  id: string;
  title: string;
  description: string;
  image?: string;
  terms?: string;
  category:
    | "raffles"
    | "loyalty-bonuses"
    | "welcome-bonuses"
    | "cashback-bonuses"
    | "free-bet-bonuses"
    | "tournaments"
    | "jackpots";
  ctaUrl?: string;
};

const CATEGORY_TABS: Array<{ key: "all" | PromoView["category"]; label: string }> = [
  { key: "all", label: "All" },
  { key: "jackpots", label: "🏆 Jackpots" },
  { key: "raffles", label: "Raffles" },
  { key: "loyalty-bonuses", label: "Loyalty Bonuses" },
  { key: "welcome-bonuses", label: "Welcome Bonuses" },
  { key: "cashback-bonuses", label: "Cashback Bonuses" },
  { key: "free-bet-bonuses", label: "Free Bet Bonuses" },
  { key: "tournaments", label: "Tournaments" },
];

function classifyCategory(type?: string, title?: string, description?: string): PromoView["category"] {
  const normalizedType = (type ?? "").toLowerCase();
  if (normalizedType.includes("raffle")) return "raffles";
  if (normalizedType.includes("tournament")) return "tournaments";
  if (normalizedType.includes("free_bet") || normalizedType.includes("freebet")) return "free-bet-bonuses";
  if (normalizedType.includes("cashback")) return "cashback-bonuses";
  if (normalizedType.includes("loyalty")) return "loyalty-bonuses";
  if (normalizedType.includes("welcome") || normalizedType.includes("signup")) return "welcome-bonuses";

  const normalized = `${title ?? ""} ${description ?? ""}`.toLowerCase();
  if (normalized.includes("raffle")) return "raffles";
  if (normalized.includes("tournament")) return "tournaments";
  if (normalized.includes("free bet") || normalized.includes("free-bet")) return "free-bet-bonuses";
  if (normalized.includes("cashback")) return "cashback-bonuses";
  if (normalized.includes("welcome")) return "welcome-bonuses";
  if (normalized.includes("loyalty")) return "loyalty-bonuses";
  return "welcome-bonuses";
}

/* ------------------------------------------------------------------ */
/* Jackpot Enter Modal                                                  */
/* ------------------------------------------------------------------ */
function JackpotEnterModal({
  jackpot,
  onClose,
  onSuccess,
}: {
  jackpot: PublicJackpot;
  onClose: () => void;
  onSuccess: (result: jackpotsApi.JackpotEntryResult) => void;
}) {
  const [quantity, setQuantity] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<jackpotsApi.JackpotEntryResult | null>(null);

  // Check auth — the modal should not be openable without being logged in, but
  // as a safety net dispatch the login event and close if auth is somehow lost.
  useEffect(() => {
    const token =
      typeof window !== "undefined"
        ? (localStorage.getItem("betet.user.auth") ?? "null")
        : "null";
    let parsed: { accessToken?: string } = {};
    try { parsed = JSON.parse(token) as { accessToken?: string }; } catch { /* ignore */ }
    if (!parsed.accessToken) {
      onClose();
      window.dispatchEvent(new Event("1birr:open-login"));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totalCost = quantity * Number(jackpot.entry_fee);

  const handleEnter = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await jackpotsApi.enterJackpot(jackpot.id, quantity);
      setSuccess(result);
      onSuccess(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Entry failed. Please try again.";
      setError(msg);
    } finally {
      setBusy(false);
    }
  };

  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.75)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-xl shadow-2xl overflow-hidden"
        style={{ background: "var(--mezzo-bg-secondary)" }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ background: "var(--mezzo-bg-tertiary)" }}
        >
          <div className="flex items-center gap-2">
            <Trophy className="w-5 h-5" style={{ color: "var(--mezzo-accent-yellow)" }} />
            <span className="font-bold text-base">{jackpot.name}</span>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {success ? (
            /* Success state */
            <div className="text-center space-y-3">
              <div className="text-4xl">🎉</div>
              <p className="font-semibold text-lg">You&apos;re in!</p>
              <p className="text-sm text-gray-300">
                {success.quantity} ticket{success.quantity > 1 ? "s" : ""} purchased for{" "}
                <span className="font-semibold">{success.total_stake.toFixed(2)} {success.currency}</span>.
              </p>
              <div className="rounded-md p-3 text-sm space-y-1" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                {success.tickets.map((t) => (
                  <p key={t.id} className="text-gray-300 font-mono text-xs">{t.ticket_code || t.coupon_code}</p>
                ))}
              </div>
              <p className="text-xs text-gray-400">
                Wallet balance: <span className="text-white">{success.wallet_balance_after.toFixed(2)} {success.currency}</span>
              </p>
              <button
                type="button"
                onClick={onClose}
                className="mt-2 w-full py-2 rounded-lg font-semibold text-black"
                style={{ background: "var(--mezzo-accent-green)" }}
              >
                Close
              </button>
            </div>
          ) : (
            /* Entry form */
            <>
              {jackpot.description && (
                <p className="text-sm text-gray-300">{jackpot.description}</p>
              )}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-md p-3" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                  <p className="text-gray-400 text-xs mb-1">Prize Pool</p>
                  <p className="font-bold text-base" style={{ color: "var(--mezzo-accent-yellow)" }}>
                    {Number(jackpot.prize_pool).toLocaleString()} {jackpot.currency}
                  </p>
                </div>
                <div className="rounded-md p-3" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                  <p className="text-gray-400 text-xs mb-1">Entry Fee</p>
                  <p className="font-bold text-base">
                    {Number(jackpot.entry_fee).toFixed(2)} {jackpot.currency}
                  </p>
                </div>
                <div className="rounded-md p-3" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                  <p className="text-gray-400 text-xs mb-1">Closes</p>
                  <p className="font-semibold text-sm">{formatDate(jackpot.ends_at)}</p>
                </div>
                <div className="rounded-md p-3" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                  <p className="text-gray-400 text-xs mb-1">Tickets Sold</p>
                  <p className="font-semibold text-sm">
                    {jackpot.tickets_sold}
                    {jackpot.max_entries ? ` / ${jackpot.max_entries}` : ""}
                  </p>
                </div>
              </div>

              {/* Prize tiers */}
              {jackpot.rules?.prize_tiers && jackpot.rules.prize_tiers.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-400 font-semibold uppercase tracking-wide">Prize Tiers</p>
                  {jackpot.rules.prize_tiers.map((tier, i) => (
                    <div key={i} className="flex justify-between text-sm rounded px-3 py-2" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                      <span className="text-gray-300">{tier.label || `${tier.matches} correct picks`}</span>
                      <span className="font-semibold" style={{ color: "var(--mezzo-accent-yellow)" }}>
                        {tier.prize.toLocaleString()} {jackpot.currency}
                        {tier.shared ? " (shared)" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Quantity selector */}
              <div className="space-y-2">
                <label className="text-sm font-semibold">Number of Tickets</label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="w-10 h-10 rounded-full font-bold text-lg"
                    style={{ background: "var(--mezzo-bg-tertiary)" }}
                  >−</button>
                  <span className="text-xl font-bold w-8 text-center">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity((q) => Math.min(50, q + 1))}
                    className="w-10 h-10 rounded-full font-bold text-lg"
                    style={{ background: "var(--mezzo-bg-tertiary)" }}
                  >+</button>
                </div>
                <p className="text-xs text-gray-400">
                  Total: <span className="text-white font-semibold">{totalCost.toFixed(2)} {jackpot.currency}</span>
                </p>
              </div>

              {error && (
                <div className="rounded-md px-3 py-2 text-sm text-red-400 border border-red-500/30" style={{ background: "rgba(239,68,68,0.1)" }}>
                  {error}
                </div>
              )}

              <button
                type="button"
                onClick={() => void handleEnter()}
                disabled={busy}
                className="w-full py-3 rounded-lg font-bold text-black text-base disabled:opacity-50"
                style={{ background: "var(--mezzo-accent-green)" }}
              >
                {busy ? "Processing..." : `Enter Jackpot — ${totalCost.toFixed(2)} ${jackpot.currency}`}
              </button>
              <p className="text-xs text-gray-500 text-center">
                You must be logged in with sufficient balance to enter.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Jackpot Card                                                         */
/* ------------------------------------------------------------------ */
function JackpotCard({
  jackpot,
  onEnter,
}: {
  jackpot: PublicJackpot;
  onEnter: (j: PublicJackpot) => void;
}) {
  const formatDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : "—";

  const progressPct =
    jackpot.max_entries && jackpot.max_entries > 0
      ? Math.min(100, Math.round((jackpot.tickets_sold / jackpot.max_entries) * 100))
      : null;

  const isAvailable =
    ["scheduled", "running"].includes(jackpot.status) &&
    (!jackpot.ends_at || new Date(jackpot.ends_at) > new Date());

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "var(--mezzo-bg-secondary)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      {/* Trophy banner */}
      <div
        className="px-5 py-4 flex items-center gap-3"
        style={{ background: "linear-gradient(135deg, rgba(250,204,21,0.15) 0%, rgba(0,0,0,0) 100%)" }}
      >
        <div
          className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(250,204,21,0.15)" }}
        >
          <Trophy className="w-7 h-7" style={{ color: "var(--mezzo-accent-yellow)" }} />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-lg leading-tight truncate">{jackpot.name}</h3>
          <p className="text-xs text-gray-400">
            {isAvailable ? (
              <span className="text-green-400">● Live Now</span>
            ) : (
              <span className="text-gray-500">● {jackpot.status}</span>
            )}
            {jackpot.ends_at && (
              <span className="ml-2">Closes {formatDate(jackpot.ends_at)}</span>
            )}
          </p>
        </div>
      </div>

      <div className="px-5 pb-5 space-y-4">
        {/* Prize pool highlight */}
        <div className="text-center py-3 rounded-lg" style={{ background: "var(--mezzo-bg-tertiary)" }}>
          <p className="text-xs text-gray-400 mb-1">Total Prize Pool</p>
          <p className="text-3xl font-black" style={{ color: "var(--mezzo-accent-yellow)" }}>
            {Number(jackpot.prize_pool).toLocaleString()}
          </p>
          <p className="text-sm text-gray-400">{jackpot.currency}</p>
        </div>

        {jackpot.description && (
          <p className="text-sm text-gray-300 leading-relaxed">{jackpot.description}</p>
        )}

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-md py-2" style={{ background: "var(--mezzo-bg-tertiary)" }}>
            <p className="text-xs text-gray-400">Entry</p>
            <p className="font-semibold">{Number(jackpot.entry_fee).toFixed(0)} {jackpot.currency}</p>
          </div>
          <div className="rounded-md py-2" style={{ background: "var(--mezzo-bg-tertiary)" }}>
            <p className="text-xs text-gray-400">Events</p>
            <p className="font-semibold">{jackpot.rules?.event_ids?.length ?? "—"}</p>
          </div>
          <div className="rounded-md py-2" style={{ background: "var(--mezzo-bg-tertiary)" }}>
            <p className="text-xs text-gray-400">Sold</p>
            <p className="font-semibold">{jackpot.tickets_sold}</p>
          </div>
        </div>

        {/* Progress bar */}
        {progressPct !== null && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-gray-400">
              <span>{jackpot.tickets_sold} tickets sold</span>
              <span>{jackpot.max_entries} max</span>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "var(--mezzo-bg-tertiary)" }}>
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${progressPct}%`, background: "var(--mezzo-accent-green)" }}
              />
            </div>
          </div>
        )}

        {/* Enter button */}
        {isAvailable ? (
          <button
            type="button"
            onClick={() => {
              // All jackpot entries debit the user's wallet — must be logged in.
              const raw = typeof window !== "undefined"
                ? (localStorage.getItem("betet.user.auth") ?? "null")
                : "null";
              let parsed: { accessToken?: string } = {};
              try { parsed = JSON.parse(raw) as { accessToken?: string }; } catch { /* ignore */ }
              if (!parsed.accessToken) {
                window.dispatchEvent(new Event("1birr:open-login"));
                return;
              }
              onEnter(jackpot);
            }}
            className="w-full py-3 rounded-lg font-bold text-black text-base"
            style={{ background: "var(--mezzo-accent-green)" }}
          >
            <Ticket className="inline-block w-4 h-4 mr-1 -mt-0.5" />
            Enter Jackpot
          </button>
        ) : (
          <button
            type="button"
            disabled
            className="w-full py-3 rounded-lg font-bold text-gray-400 cursor-not-allowed"
            style={{ background: "var(--mezzo-bg-tertiary)" }}
          >
            Not Available
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Page                                                            */
/* ------------------------------------------------------------------ */
export default function PromotionsPage() {
  const router = useRouter();
  const [promotions, setPromotions] = useState<PromoView[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<"all" | PromoView["category"]>("all");
  const [cashbackRules, setCashbackRules] = useState<promotionsApi.CashbackRuleCard[]>([]);
  const [activeCashbackProfile, setActiveCashbackProfile] = useState<{
    rule_id: string | null;
    rule_name: string | null;
    version: number | null;
  } | null>(null);
  const [jackpots, setJackpots] = useState<PublicJackpot[]>([]);
  const [selectedJackpot, setSelectedJackpot] = useState<PublicJackpot | null>(null);
  const [jackpotEntryCount, setJackpotEntryCount] = useState(0);

  const loadPromotions = () => {
    setLoading(true);
    return Promise.all([
      promotionsApi.listActivePromotions().catch(() => ({ items: [] as Array<{
        id: string;
        title: string;
        description?: string;
        type?: string;
        image_url?: string;
        terms?: string;
        cta_url?: string;
      }> })),
      publicConfigApi.listPromotionBanners().catch(() => ({ items: [] })),
      promotionsApi.listCashbackRules().catch(() => ({ active_rule: "rule_one" as const, payout_as: "bonus" as const, rules: [], active_profile: null })),
      jackpotsApi.listActiveJackpots().catch(() => ({ items: [] })),
    ])
      .then(([activeRes, bannerRes, cashbackRulesRes, jackpotsRes]) => {
        setJackpots(jackpotsRes.items ?? []);
        const fromActive = (activeRes.items ?? []).map((p, idx) => {
          const category = classifyCategory(p.type, p.title, p.description);
          return {
            id: p.id || `active-promo-${idx}`,
            title: p.title || "Promotion",
            description: p.description ?? "",
            image: p.image_url || undefined,
            terms: p.terms ?? "",
            category,
            ctaUrl: p.cta_url || undefined,
          } satisfies PromoView;
        });
        const fromBanners = (bannerRes.items ?? [])
          .filter((p) => p?.is_active !== false)
          .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
          .map((p, idx) => {
            const category = classifyCategory(p.bonus_type, p.title, p.description);
            return {
              id: p.id || `banner-promo-${idx}`,
              title: p.title || "Promotion",
              description: p.description ?? "",
              image: p.image_url || p.mobile_image_url || undefined,
              terms: p.bonus_type ?? "",
              category,
              ctaUrl: p.cta_url || undefined,
            } satisfies PromoView;
          });

        const merged = [...fromActive, ...fromBanners];
        const deduped = merged.filter(
          (item, idx, arr) => arr.findIndex((x) => x.id === item.id) === idx
        );
        setPromotions(deduped);
        setCashbackRules(cashbackRulesRes.rules ?? []);
        setActiveCashbackProfile(cashbackRulesRes.active_profile ?? null);
      })
      .catch(() => {
        setPromotions([]);
        setCashbackRules([]);
        setActiveCashbackProfile(null);
        setJackpots([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    void loadPromotions();
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadPromotions();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  const hasPromos = useMemo(() => promotions.length > 0, [promotions]);
  const hasActiveJackpots = useMemo(() => jackpots.length > 0, [jackpots]);
  const activeCashbackSlots = useMemo(
    () =>
      cashbackRules
        .filter((rule) => rule.is_active)
        .flatMap((rule) =>
          rule.slots
            .filter((slot) => slot.enabled)
            .map((slot) => ({
              id: `${rule.rule_key}-${slot.slot_key}`,
              ruleLabel: rule.label,
              slot,
            }))
        ),
    [cashbackRules]
  );
  const hasActiveCashback = useMemo(
    () => activeCashbackSlots.length > 0,
    [activeCashbackSlots]
  );
  const visibleTabs = useMemo(
    () =>
      CATEGORY_TABS.filter(
        (t) =>
          t.key === "all" ||
          (t.key === "jackpots" && hasActiveJackpots) ||
          (t.key === "cashback-bonuses" && hasActiveCashback) ||
          promotions.some((p) => p.category === t.key)
      ),
    [promotions, hasActiveCashback, hasActiveJackpots]
  );
  const visiblePromotions = useMemo(
    () =>
      activeCategory === "all"
        ? promotions
        : promotions.filter((p) => p.category === activeCategory),
    [promotions, activeCategory]
  );
  const showJackpotsOnly = activeCategory === "jackpots";
  const showCashbackRuleOnly = activeCategory === "cashback-bonuses";
  const promotionsForRender = (showCashbackRuleOnly || showJackpotsOnly) ? [] : visiblePromotions;
  return (
    <div className="flex flex-col min-h-[calc(100vh-120px)] md:min-h-[calc(100vh-180px)]">
      {/* Promotions Content */}
      <div className="flex-1" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="p-4 sm:p-6">
          {/* Mobile-only back button — symmetrical with /games so both
              top-level mobile pages have a consistent return path. */}
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            className="md:hidden inline-flex items-center gap-2 mb-3 px-2 py-1 -ml-2 rounded text-sm text-gray-200 hover:text-white hover:bg-[var(--mezzo-bg-tertiary)] transition-colors touch-target"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="font-semibold">Back</span>
          </button>
          <div className="flex items-center gap-3 mb-6">
            <Gift className="w-7 h-7 sm:w-8 sm:h-8 text-[var(--mezzo-accent-yellow)]" />
            <h1 className="text-2xl sm:text-3xl font-bold">PROMOTIONS</h1>
          </div>

          {/* Category tabs — shown when there are jackpots, cashback, or 2+ promo categories */}
          {(!loading && (hasActiveJackpots || hasActiveCashback || (hasPromos && visibleTabs.length > 2))) ? (
            <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
              {visibleTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveCategory(tab.key)}
                  className={`px-4 py-2 rounded-full text-sm font-semibold whitespace-nowrap transition-colors ${
                    activeCategory === tab.key ? "text-black" : "text-gray-300 hover:text-white"
                  }`}
                  style={
                    activeCategory === tab.key
                      ? { background: "var(--mezzo-accent-green)" }
                      : { background: "var(--mezzo-bg-secondary)" }
                  }
                >
                  {tab.label}
                </button>
              ))}
            </div>
          ) : null}

          <div className="space-y-6">
            {loading && <p className="text-sm text-gray-400">Loading promotions...</p>}

            {/* ---- Jackpots section ---- */}
            {!loading && (showJackpotsOnly || activeCategory === "all") && hasActiveJackpots && (
              <div className="space-y-4">
                {activeCategory === "all" && (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Trophy className="w-5 h-5" style={{ color: "var(--mezzo-accent-yellow)" }} />
                      <h2 className="text-lg font-bold">Super Jackpots</h2>
                    </div>
                    {jackpots.length > 2 && (
                      <button
                        type="button"
                        onClick={() => setActiveCategory("jackpots")}
                        className="text-xs underline"
                        style={{ color: "var(--mezzo-accent-green)" }}
                      >
                        View all ({jackpots.length})
                      </button>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {(showJackpotsOnly ? jackpots : jackpots.slice(0, 2)).map((j) => (
                    <JackpotCard
                      key={j.id}
                      jackpot={j}
                      onEnter={(jk) => setSelectedJackpot(jk)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* ---- Jackpots tab — no jackpots message ---- */}
            {!loading && showJackpotsOnly && !hasActiveJackpots && (
              <p className="text-sm text-gray-400">No active jackpots right now. Check back soon!</p>
            )}

            {/* ---- Cashback section ---- */}
            {!loading && showCashbackRuleOnly && activeCashbackSlots.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-base font-semibold">Active Cashback Rules</h3>
                {activeCashbackProfile?.version && (
                  <p className="text-xs text-gray-400">
                    Active Admin Rule: {activeCashbackProfile.rule_name || "Cashback Rule"} (v{activeCashbackProfile.version})
                  </p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {activeCashbackSlots.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-md border p-3"
                      style={{ background: "var(--mezzo-bg-secondary)", borderColor: "var(--mezzo-accent-green)" }}
                    >
                      <p className="text-sm font-semibold">{entry.slot.label}</p>
                      <p className="text-xs text-gray-400 mb-2">{entry.ruleLabel}</p>
                      <p className="text-xs text-gray-400">
                        Min selections {entry.slot.min_selections} | Min odds/leg {entry.slot.min_odds_per_leg}
                      </p>
                      <p className="text-xs text-gray-400">
                        Min stake {entry.slot.min_stake} | Max cashback {entry.slot.max_cashback}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        Tiers: {entry.slot.tiers.map((t) => `${t.min_odds}-${t.max_odds ?? "∞"}:${t.pct}%`).join(" | ")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ---- Empty states ---- */}
            {!loading && !hasPromos && !hasActiveCashback && !hasActiveJackpots && (
              <p className="text-sm text-gray-400">
                No active promotions are available right now.
              </p>
            )}
            {!loading && hasPromos && promotionsForRender.length === 0 && !showCashbackRuleOnly && !showJackpotsOnly && (
              <p className="text-sm text-gray-400">
                No promotions in this category right now.
              </p>
            )}

            {/* ---- Regular promotions grid ---- */}
            {promotionsForRender.map((promo) => (
              <div
                key={promo.id}
                className="rounded-lg overflow-hidden flex flex-col sm:flex-row"
                style={{ background: "var(--mezzo-bg-secondary)" }}
              >
                {promo.image ? (
                  <img
                    src={promo.image}
                    alt={promo.title}
                    className="w-full h-40 sm:w-64 sm:h-48 object-cover flex-shrink-0"
                  />
                ) : (
                  <div
                    className="w-full h-40 sm:w-64 sm:h-48 flex items-center justify-center text-sm text-gray-300 flex-shrink-0"
                    style={{ background: "var(--mezzo-bg-tertiary)" }}
                  >
                    {promo.title}
                  </div>
                )}
                <div className="p-4 sm:p-6 flex-1 min-w-0">
                  <h2 className="text-xl sm:text-2xl font-bold mb-3">{promo.title}</h2>
                  <p className="text-gray-300 mb-4">{promo.description}</p>
                  {promo.terms && <p className="text-sm text-gray-500 mb-4">{promo.terms}</p>}
                  {promo.ctaUrl && (
                    <button
                      className="px-6 py-2 rounded text-black font-semibold"
                      style={{ background: "var(--mezzo-accent-green)" }}
                      onClick={() => router.push(promo.ctaUrl || "/")}
                    >
                      Open
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Jackpot Enter Modal */}
      {selectedJackpot && (
        <JackpotEnterModal
          jackpot={selectedJackpot}
          onClose={() => setSelectedJackpot(null)}
          onSuccess={(result) => {
            setJackpotEntryCount((c) => c + result.quantity);
            // Refresh jackpot list to update sold count
            void jackpotsApi.listActiveJackpots()
              .then((r) => setJackpots(r.items ?? []))
              .catch(() => null);
          }}
        />
      )}
    </div>
  );
}
