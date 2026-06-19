"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Gift } from "lucide-react";
import { promotionsApi, publicConfigApi } from "@/lib/api";

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
    | "tournaments";
  ctaUrl?: string;
};

const CATEGORY_TABS: Array<{ key: "all" | PromoView["category"]; label: string }> = [
  { key: "all", label: "All" },
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
      promotionsApi.listCashbackRules().catch(() => ({ active_rule: "rule_one" as const, payout_as: "bonus" as const, rules: [] })),
    ])
      .then(([activeRes, bannerRes, cashbackRulesRes]) => {
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
  const visibleTabs = useMemo(
    () =>
      CATEGORY_TABS.filter(
        (t) => t.key === "all" || promotions.some((p) => p.category === t.key)
      ),
    [promotions]
  );
  const visiblePromotions = useMemo(
    () =>
      activeCategory === "all"
        ? promotions
        : promotions.filter((p) => p.category === activeCategory),
    [promotions, activeCategory]
  );
  const showCashbackRuleOnly = activeCategory === "cashback-bonuses";
  const promotionsForRender = showCashbackRuleOnly ? [] : visiblePromotions;
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

          {/* Category tabs — shown when more than one category is active */}
          {!loading && hasPromos && visibleTabs.length > 2 && (
            <div className="flex gap-2 mb-6 overflow-x-auto">
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
          )}

          <div className="space-y-6">
            {loading && <p className="text-sm text-gray-400">Loading promotions...</p>}
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
            {!loading && !hasPromos && (
              <p className="text-sm text-gray-400">
                No active promotions are available right now.
              </p>
            )}
            {!loading && hasPromos && promotionsForRender.length === 0 && !showCashbackRuleOnly && (
              <p className="text-sm text-gray-400">
                No promotions in this category right now.
              </p>
            )}
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
    </div>
  );
}
