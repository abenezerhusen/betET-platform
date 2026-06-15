"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChevronUp,
  ChevronDown,
  Send,
  Facebook,
  Instagram,
  Youtube,
  Twitter,
  ShieldCheck,
} from "lucide-react";
import { publicConfigApi } from "@/lib/api";
import type { PublicGeneral } from "@/lib/api/publicConfig";

const BRAND_GREEN = "#22c55e";

const companyLinks = [
  { name: "About Us", href: "/about" },
  { name: "Careers", href: "/about" },
  { name: "Responsible Gaming", href: "/rules" },
  { name: "Press", href: "/about" },
];

const legalLinks = [
  { name: "Terms & Conditions", href: "/rules" },
  { name: "Privacy Policy", href: "/privacy" },
  { name: "Cookies Policy", href: "/cookies" },
  { name: "Account Rules", href: "/account-rules" },
];

const sportsLinks = [
  { name: "Football", href: "/" },
  { name: "Basketball", href: "/" },
  { name: "Tennis", href: "/" },
  { name: "Cricket", href: "/" },
  { name: "Volleyball", href: "/" },
];

const trustBadges = ["Licensed & Regulated", "18+ Only", "SSL Secured"];

const DEFAULT_FOOTER_TEXT =
  "Ethiopia's modern sports betting platform. Bet on football, basketball, and more. Fast payouts, secure accounts.";
const DEFAULT_SUPPORT_EMAIL = "support@1birr.bet";
const DEFAULT_TELEGRAM = "https://t.me/1birr_support";

export function Footer() {
  // Always start collapsed on open/refresh so the footer does not cover
  // the betting content. The user can expand it with the toggle button.
  const [isOpen, setIsOpen] = useState(false);
  // Admin-managed content (Settings → General). Static copy is the
  // fallback so the footer renders identically until the admin saves.
  const [cfg, setCfg] = useState<PublicGeneral | null>(null);

  useEffect(() => {
    let cancelled = false;
    publicConfigApi
      .getPublicGeneral()
      .then((res) => {
        if (!cancelled) setCfg(res);
      })
      .catch(() => {
        /* keep static fallbacks */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const footerText = cfg?.footer_text || DEFAULT_FOOTER_TEXT;
  const supportEmail = cfg?.support?.email || cfg?.contact?.email || DEFAULT_SUPPORT_EMAIL;
  const telegramHref = cfg?.social?.telegram || DEFAULT_TELEGRAM;
  const telegramHandle = telegramHref.includes("t.me/")
    ? `@${telegramHref.split("t.me/")[1]?.replace(/\/$/, "")}`
    : telegramHref;

  const socialLinks = [
    { name: "Telegram", href: telegramHref, Icon: Send },
    { name: "Facebook", href: cfg?.social?.facebook || "#", Icon: Facebook },
    { name: "Instagram", href: cfg?.social?.instagram || "#", Icon: Instagram },
    ...(cfg?.social?.twitter
      ? [{ name: "Twitter", href: cfg.social.twitter, Icon: Twitter }]
      : [{ name: "YouTube", href: "#", Icon: Youtube }]),
  ];

  const toggleFooter = () => {
    setIsOpen(!isOpen);
  };

  return (
    <footer
      className="border-t transition-all duration-300"
      style={{
        background: "linear-gradient(180deg, var(--mezzo-bg-secondary) 0%, #0a0a12 100%)",
        borderColor: "var(--mezzo-border)",
      }}
    >
      {/* Hide / Show Footer Toggle */}
      <div className="flex justify-center items-center -mt-4">
        <button
          onClick={toggleFooter}
          className="w-8 h-8 rounded-full flex items-center justify-center hover:scale-110 transition-transform"
          style={{ background: "var(--mezzo-bg-tertiary)" }}
          title={isOpen ? "Hide footer" : "Show footer"}
          aria-expanded={isOpen}
          aria-label={isOpen ? "Hide footer" : "Show footer"}
        >
          {isOpen ? (
            <ChevronDown className="w-5 h-5 text-white" />
          ) : (
            <ChevronUp className="w-5 h-5 text-white" />
          )}
        </button>
      </div>

      {/* Footer Content (hidden when collapsed) */}
      <div
        className={`overflow-hidden transition-all duration-300 ${
          isOpen ? "max-h-[1600px] opacity-100" : "max-h-0 opacity-0"
        }`}
      >
        <div className="max-w-7xl mx-auto px-6 py-10">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {/* Brand + description + trust badges */}
            <div>
              <Link href="/" className="flex items-center gap-2" aria-label="1birr.bet home">
                <span
                  className="flex items-center justify-center rounded-lg font-extrabold text-black h-9 w-9 text-base shrink-0"
                  style={{ background: BRAND_GREEN }}
                >
                  1B
                </span>
                <span className="font-extrabold text-xl leading-none tracking-tight">
                  <span className="text-white">1birr</span>
                  <span style={{ color: BRAND_GREEN }}>.bet</span>
                </span>
              </Link>

              <p className="mt-4 text-sm text-gray-400 leading-relaxed max-w-xs whitespace-pre-line">
                {footerText}
              </p>

              <div className="mt-5 flex flex-wrap gap-2">
                {trustBadges.map((badge) => (
                  <span
                    key={badge}
                    className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium text-gray-200"
                    style={{ borderColor: "var(--mezzo-border)", background: "var(--mezzo-bg-tertiary)" }}
                  >
                    <ShieldCheck className="w-3.5 h-3.5" style={{ color: BRAND_GREEN }} />
                    {badge}
                  </span>
                ))}
              </div>
            </div>

            {/* Support */}
            <div>
              <h3 className="text-white font-semibold mb-4">Support</h3>
              <div className="space-y-4">
                <div
                  className="rounded-lg p-3"
                  style={{ background: "var(--mezzo-bg-tertiary)", border: "1px solid var(--mezzo-border)" }}
                >
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Email Support</p>
                  <a
                    href={`mailto:${supportEmail}`}
                    className="text-sm font-semibold hover:underline"
                    style={{ color: BRAND_GREEN }}
                  >
                    {supportEmail}
                  </a>
                  <p className="text-xs text-gray-500 mt-0.5">Reply within 24 hours</p>
                </div>

                <div
                  className="rounded-lg p-3"
                  style={{ background: "var(--mezzo-bg-tertiary)", border: "1px solid var(--mezzo-border)" }}
                >
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Live Chat</p>
                  <p className="text-sm font-semibold text-blue-400">Available 24/7</p>
                  <p className="text-xs text-gray-500 mt-0.5">Instant help anytime</p>
                </div>

                <div
                  className="rounded-lg p-3"
                  style={{ background: "var(--mezzo-bg-tertiary)", border: "1px solid var(--mezzo-border)" }}
                >
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Telegram</p>
                  <a
                    href={telegramHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-semibold hover:underline"
                    style={{ color: BRAND_GREEN }}
                  >
                    {telegramHandle}
                  </a>
                  <p className="text-xs text-gray-500 mt-0.5">Fast community support</p>
                </div>
              </div>
            </div>

            {/* Company + Legal */}
            <div className="space-y-8">
              <div>
                <h3 className="text-white font-semibold mb-4">Company</h3>
                <ul className="space-y-2.5">
                  {companyLinks.map((link) => (
                    <li key={link.name}>
                      <Link
                        href={link.href}
                        className="text-sm text-gray-400 hover:text-white transition-colors"
                      >
                        {link.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-white font-semibold mb-4">Legal</h3>
                <ul className="space-y-2.5">
                  {legalLinks.map((link) => (
                    <li key={link.name}>
                      <Link
                        href={link.href}
                        className="text-sm text-gray-400 hover:text-white transition-colors"
                      >
                        {link.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Sports + Follow Us */}
            <div className="space-y-8">
              <div>
                <h3 className="text-white font-semibold mb-4">Sports</h3>
                <ul className="space-y-2.5">
                  {sportsLinks.map((link) => (
                    <li key={link.name}>
                      <Link
                        href={link.href}
                        className="text-sm text-gray-400 hover:text-white transition-colors"
                      >
                        {link.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="text-white font-semibold mb-4">Follow Us</h3>
                <div className="flex items-center gap-3">
                  {socialLinks.map(({ name, href, Icon }) => (
                    <Link
                      key={name}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={name}
                      className="flex items-center justify-center w-9 h-9 rounded-md hover:scale-110 transition-transform"
                      style={{ background: "var(--mezzo-bg-tertiary)", border: "1px solid var(--mezzo-border)" }}
                    >
                      <Icon className="w-4 h-4 text-gray-300" />
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Copyright */}
          <div
            className="mt-10 pt-6 border-t text-center text-xs text-gray-500"
            style={{ borderColor: "var(--mezzo-border)" }}
          >
            <p>© 2026 1birr.bet. All rights reserved.</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
