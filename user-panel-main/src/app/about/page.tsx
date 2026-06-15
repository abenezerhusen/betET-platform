"use client";

/**
 * `/about` — About Us.
 *
 * Content is managed from the Admin Panel (Settings → General → Company →
 * About Us) and served via GET /api/public/general, alongside the
 * platform contact information.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Info, Mail, Phone } from "lucide-react";
import { publicConfigApi } from "@/lib/api";
import type { PublicGeneral } from "@/lib/api/publicConfig";

const FALLBACK_ABOUT =
  "Ethiopia's modern sports betting platform. Bet on football, basketball and more — with fast payouts and secure accounts.";

export default function AboutPage() {
  const router = useRouter();
  const [cfg, setCfg] = useState<PublicGeneral | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    publicConfigApi
      .getPublicGeneral()
      .then((res) => {
        if (!cancelled) setCfg(res);
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
            <Info className="w-7 h-7 sm:w-8 sm:h-8 text-[var(--mezzo-accent-yellow)]" />
            <h1 className="text-2xl sm:text-3xl font-bold">ABOUT US</h1>
          </div>

          <div
            className="p-5 sm:p-6 rounded-lg"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            {loading ? (
              <p className="text-sm text-gray-400">Loading…</p>
            ) : (
              <div className="text-sm text-gray-300 leading-relaxed whitespace-pre-line">
                {cfg?.about_us || FALLBACK_ABOUT}
              </div>
            )}
          </div>

          {(cfg?.contact?.email || cfg?.contact?.phone) && (
            <div
              className="mt-4 p-5 rounded-lg space-y-2"
              style={{ background: "var(--mezzo-bg-secondary)" }}
            >
              <h2 className="font-semibold text-white mb-2">Contact</h2>
              {cfg.contact.email && (
                <a
                  href={`mailto:${cfg.contact.email}`}
                  className="flex items-center gap-2 text-sm text-gray-300 hover:text-white"
                >
                  <Mail className="w-4 h-4 text-[var(--mezzo-accent-green)]" />
                  {cfg.contact.email}
                </a>
              )}
              {cfg.contact.phone && (
                <a
                  href={`tel:${cfg.contact.phone}`}
                  className="flex items-center gap-2 text-sm text-gray-300 hover:text-white"
                >
                  <Phone className="w-4 h-4 text-[var(--mezzo-accent-green)]" />
                  {cfg.contact.phone}
                </a>
              )}
            </div>
          )}

          {cfg?.underage_disclaimer ? (
            <p className="mt-6 text-xs text-gray-500 text-center whitespace-pre-line">
              {cfg.underage_disclaimer}
            </p>
          ) : (
            <p className="mt-6 text-xs text-gray-500 text-center">
              18+ only. Gamble responsibly.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
