"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Gift } from "lucide-react";
import { bonusesApi, promotionsApi, tournamentsApi } from "@/lib/api";

type PromoView = {
  id: string;
  title: string;
  description: string;
  image: string;
  terms: string;
  status: string;
  type: "bonus" | "raffle" | "tournament";
  ctaUrl: string;
  ctaLabel: string;
};

export default function PromotionsPage() {
  const router = useRouter();
  const [promotions, setPromotions] = useState<PromoView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    promotionsApi
      .listActivePromotions()
      .then((res) => {
        if (cancelled) return;
        setPromotions(
          (res.items ?? []).map((p) => ({
            id: p.id,
            title: p.title,
            description: p.description ?? "",
            image: p.image_url || "https://ext.same-assets.com/1203561035/2427311734.jpeg",
            terms: p.terms,
            status: p.is_claimed ? "claimed" : "available",
            type: p.type,
            ctaUrl: p.cta_url,
            ctaLabel: p.cta_label,
          }))
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasPromos = useMemo(() => promotions.length > 0, [promotions]);
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

          <div className="space-y-6">
            {loading && <p className="text-sm text-gray-400">Loading promotions...</p>}
            {!loading && !hasPromos && (
              <p className="text-sm text-gray-400">
                No promotions available right now.
              </p>
            )}
            {promotions.map((promo) => (
              <div
                key={promo.id}
                className="rounded-lg overflow-hidden flex flex-col sm:flex-row"
                style={{ background: "var(--mezzo-bg-secondary)" }}
              >
                <img
                  src={promo.image}
                  alt={promo.title}
                  className="w-full h-40 sm:w-64 sm:h-48 object-cover flex-shrink-0"
                />
                <div className="p-4 sm:p-6 flex-1 min-w-0">
                  <h2 className="text-xl sm:text-2xl font-bold mb-3">{promo.title}</h2>
                  <p className="text-gray-300 mb-4">{promo.description}</p>
                  <p className="text-sm text-gray-500 mb-4">{promo.terms}</p>
                  <button
                    className="px-6 py-2 rounded text-black font-semibold disabled:opacity-50"
                    style={{ background: "var(--mezzo-accent-green)" }}
                    onClick={async () => {
                      if (promo.type === "bonus") {
                        void bonusesApi.claimBonus(promo.id);
                      } else if (promo.type === "tournament") {
                        try {
                          await tournamentsApi.joinTournament(promo.id);
                          setPromotions((prev) =>
                            prev.map((p) =>
                              p.id === promo.id ? { ...p, status: "claimed" } : p
                            )
                          );
                        } catch (err) {
                          alert(
                            `Couldn’t join tournament: ${(err as Error).message ?? err}`
                          );
                        }
                      } else {
                        router.push(promo.ctaUrl || "/");
                      }
                    }}
                    disabled={promo.status === "claimed" || promo.status === "expired"}
                  >
                    {promo.status === "claimed"
                      ? promo.type === "tournament"
                        ? "Joined"
                        : "Claimed"
                      : promo.ctaLabel || "Open"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Terms & Conditions */}
          <div className="mt-8 p-6 rounded-lg" style={{ background: "var(--mezzo-bg-secondary)" }}>
            <h3 className="text-lg font-bold mb-3">General Terms & Conditions</h3>
            <div className="text-sm text-gray-400 space-y-2">
              <p>• All promotions are subject to the general terms and conditions</p>
              <p>• 1birr.bet reserves the right to modify or cancel promotions at any time</p>
              <p>• Only one promotion per person/household/IP address</p>
              <p>• Bonus funds must be wagered before withdrawal</p>
              <p>• 18+ only. Gamble responsibly.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
