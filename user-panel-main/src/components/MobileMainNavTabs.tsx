"use client";

/**
 * Mobile-only horizontal main navigation tabs.
 *
 * Shown just below the home-page banner on phones and tablets (`lg:hidden`)
 * so users get quick access to the primary sections (HOME / GAMES /
 * AVIATOR / JETX / KENO) exactly as they appear in the desktop header
 * nav row. A "MORE" button opens a popover containing the same
 * secondary items the desktop "MORE" menu already exposes — keeping
 * parity with the desktop experience without duplicating any data.
 *
 * The desktop header nav is `hidden lg:flex` and remains untouched; this
 * component only renders at `<lg` widths so desktop visuals don't change.
 *
 * The MORE popover is intentionally rendered with `position: fixed`
 * rather than the shared `DropdownMenu` (which uses `position: absolute`)
 * because this nav row is a horizontally scrollable container
 * (`overflow-x-auto`) and per the CSS spec that also clips vertical
 * overflow — an absolutely positioned dropdown inside it would be
 * invisible on mobile. Fixed positioning sidesteps the clipping.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { publicConfigApi } from "@/lib/api";
import type { NavbarItem as PublicNavbarItem } from "@/lib/api/publicConfig";
import {
  Home as HomeIcon,
  Gamepad2,
  Plane,
  Zap,
  Hash,
  MoreHorizontal,
  Radio,
  PlayCircle,
  Trophy,
  Ticket,
  Gift,
} from "lucide-react";

type NavItem = {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
};

// Primary items match the desktop header's `mainNavItems` list, with
// "FAST KENO" shortened to "KENO" to match the mockup's phone layout.
const primaryItems: NavItem[] = [
  { name: "HOME", href: "/", icon: HomeIcon },
  { name: "GAMES", href: "/games", icon: Gamepad2 },
  { name: "AVIATOR", href: "/games?play=aviator", icon: Plane },
  { name: "JETX", href: "/games?play=jetx", icon: Zap },
  { name: "KENO", href: "/games?play=fast-keno", icon: Hash },
];

// "MORE" surfaces the same secondary destinations the desktop header's
// MORE dropdown already offers, so nothing is lost on mobile.
const moreItems: NavItem[] = [
  { name: "PROMOTIONS", href: "/promotions", icon: Gift },
  { name: "SPORT", href: "/sport", icon: Radio },
  { name: "LIVE", href: "/live", icon: Radio },
  { name: "LIVE GAMES", href: "/live-games", icon: PlayCircle },
  { name: "VIRTUAL SPORTS", href: "/virtual-sports", icon: Trophy },
  { name: "COUPON CHECK", href: "/coupon-check", icon: Ticket },
];

function iconForNavLabel(label: string): NavItem["icon"] {
  const key = label.toLowerCase();
  if (key.includes("home")) return HomeIcon;
  if (key.includes("game")) return Gamepad2;
  if (key.includes("aviator")) return Plane;
  if (key.includes("jetx")) return Zap;
  if (key.includes("keno")) return Hash;
  if (key.includes("promo")) return Gift;
  if (key.includes("sport")) return Trophy;
  if (key.includes("live")) return Radio;
  if (key.includes("ticket") || key.includes("coupon")) return Ticket;
  return MoreHorizontal;
}

export default function MobileMainNavTabs() {
  const pathname = usePathname() ?? "/";
  const [moreOpen, setMoreOpen] = useState(false);
  const [dynamicPrimaryItems, setDynamicPrimaryItems] = useState<NavItem[]>(primaryItems);
  const [dynamicMoreItems, setDynamicMoreItems] = useState<NavItem[]>(moreItems);
  const moreBtnRef = useRef<HTMLButtonElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null,
  );

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const moreIsActive = dynamicMoreItems.some((i) => isActive(i.href));

  useEffect(() => {
    let cancelled = false;
    publicConfigApi.listNavbarItems()
      .then((res) => {
        if (cancelled) return;
        const activeNav = (res.items ?? [])
          .filter((item: PublicNavbarItem) => item.is_active !== false)
          .sort((a: PublicNavbarItem, b: PublicNavbarItem) => (a.display_order ?? 0) - (b.display_order ?? 0));
        if (activeNav.length === 0) return;
        const main = activeNav
          .filter((i: PublicNavbarItem) => (i.bucket ?? "main") === "main")
          .map((i: PublicNavbarItem) => ({ name: i.label, href: i.href, icon: iconForNavLabel(i.label) }));
        const more = activeNav
          .filter((i: PublicNavbarItem) => i.bucket === "more")
          .map((i: PublicNavbarItem) => ({ name: i.label, href: i.href, icon: iconForNavLabel(i.label) }));
        if (main.length > 0) setDynamicPrimaryItems(main);
        if (more.length > 0) setDynamicMoreItems(more);
      })
      .catch(() => { /* keep defaults */ });
    return () => { cancelled = true; };
  }, []);

  // Close the MORE popover whenever navigation happens. `pathname` is
  // stable on the same route, so this only triggers after a real
  // transition — guaranteeing the sheet doesn't linger after a tap.
  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  // Reposition the popover whenever it opens, and anchor it to the
  // MORE button's current screen coordinates. We use `fixed` positioning
  // so the scroll container around the nav can't clip it.
  useEffect(() => {
    if (!moreOpen) return;
    const updatePos = () => {
      const el = moreBtnRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportW =
        typeof window !== "undefined" ? window.innerWidth : 0;
      setMenuPos({
        top: rect.bottom + 4,
        right: Math.max(8, viewportW - rect.right),
      });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, [moreOpen]);

  // Dismiss on Escape for accessibility / keyboard users.
  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  return (
    <>
      <nav
        aria-label="Main navigation"
        className="lg:hidden border-b overflow-x-auto hide-scrollbar"
        style={{
          background: "var(--mezzo-bg-secondary)",
          borderColor: "var(--mezzo-border)",
        }}
      >
        <div className="flex items-stretch min-w-max">
          {dynamicPrimaryItems.map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.name}
                href={item.href}
                className="relative flex flex-col items-center justify-center gap-1 px-4 sm:px-5 py-2.5 transition-colors touch-target"
                style={{
                  color: active ? "var(--mezzo-accent-yellow)" : "#cbd5e1",
                }}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[10px] font-semibold tracking-wider">
                  {item.name}
                </span>
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-full"
                    style={{ background: "var(--mezzo-accent-yellow)" }}
                  />
                )}
              </Link>
            );
          })}

          {/* MORE — opens a fixed-positioned popover with the secondary
              destinations. Fixed positioning escapes the parent's
              overflow-x-auto clipping (see file-header comment). */}
          <button
            ref={moreBtnRef}
            type="button"
            aria-label="More navigation"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((v) => !v)}
            className="relative flex flex-col items-center justify-center gap-1 px-4 sm:px-5 py-2.5 transition-colors touch-target"
            style={{
              color:
                moreOpen || moreIsActive
                  ? "var(--mezzo-accent-yellow)"
                  : "#cbd5e1",
            }}
          >
            <MoreHorizontal className="w-5 h-5" />
            <span className="text-[10px] font-semibold tracking-wider">
              MORE
            </span>
            {(moreOpen || moreIsActive) && (
              <span
                aria-hidden="true"
                className="absolute bottom-0 left-1/2 -translate-x-1/2 h-[3px] w-8 rounded-full"
                style={{ background: "var(--mezzo-accent-yellow)" }}
              />
            )}
          </button>
        </div>
      </nav>

      {/* Popover portal-ish layer: backdrop + panel, both fixed so no
          ancestor overflow can clip them. Only rendered when open. */}
      {moreOpen && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            className="lg:hidden fixed inset-0 z-[59]"
            onClick={() => setMoreOpen(false)}
            style={{ background: "transparent" }}
          />
          <div
            role="menu"
            aria-label="More navigation"
            className="lg:hidden fixed z-[60] min-w-[220px] rounded-md border shadow-xl overflow-hidden"
            style={{
              top: menuPos?.top ?? 0,
              right: menuPos?.right ?? 8,
              background: "#000",
              borderColor: "#333",
              visibility: menuPos ? "visible" : "hidden",
            }}
          >
            <ul className="py-1">
              {dynamicMoreItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <li key={item.name} role="none">
                    <Link
                      role="menuitem"
                      href={item.href}
                      onClick={() => setMoreOpen(false)}
                      className="flex items-center gap-2 w-full px-4 py-2.5 text-sm transition-colors"
                      style={{
                        color: active
                          ? "var(--mezzo-accent-yellow)"
                          : "#fff",
                        background: active
                          ? "rgba(255,193,7,0.08)"
                          : "transparent",
                      }}
                    >
                      <Icon className="w-4 h-4" />
                      <span className="font-semibold tracking-wide">
                        {item.name}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
