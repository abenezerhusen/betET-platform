"use client";

/**
 * `/rules` — Terms & Conditions / Responsible Gaming.
 *
 * The body text is managed from the Admin Panel (Settings → General →
 * Company → Terms & Conditions) and served via GET /api/public/general.
 * A static fallback is rendered until the admin saves custom content.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { publicConfigApi } from "@/lib/api";

const FALLBACK_TERMS = `1. All players must be 18 years or older.
2. Deposited funds must be wagered before they can be withdrawn — only winnings generated from played deposits are withdrawable.
3. All bets are final once placed; pending tickets may be cancelled only where the platform rules allow it.
4. Bonus funds follow their own wagering requirements and cannot be withdrawn directly.
5. The platform reserves the right to void bets affected by obvious errors (wrong odds, postponed fixtures, technical faults).
6. Winnings are subject to the applicable income tax as displayed on the bet slip.
7. Accounts found to be engaging in fraud, multi-accounting or bonus abuse may be suspended.
8. Play responsibly. If gambling stops being fun, take a break or seek help.`;

export default function RulesPage() {
  const router = useRouter();
  const [terms, setTerms] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    publicConfigApi
      .getPublicGeneral()
      .then((cfg) => {
        if (!cancelled) setTerms(cfg.terms_and_conditions ?? "");
      })
      .catch(() => {
        /* fall back to static copy */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col min-h-[calc(100vh-120px)] md:min-h-[calc(100vh-180px)]">
      <div className="flex-1" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="p-4 sm:p-6 max-w-4xl mx-auto w-full">
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
            <FileText className="w-7 h-7 sm:w-8 sm:h-8 text-[var(--mezzo-accent-yellow)]" />
            <h1 className="text-2xl sm:text-3xl font-bold">TERMS &amp; CONDITIONS</h1>
          </div>

          <div
            className="p-5 sm:p-6 rounded-lg"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            {loading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : (
              <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
                {terms || FALLBACK_TERMS}
              </div>
            )}
          </div>

          <p className="mt-6 text-xs text-gray-500 text-center">
            18+ only. Gamble responsibly.
          </p>
        </div>
      </div>
    </div>
  );
}
