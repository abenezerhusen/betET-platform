"use client";

/**
 * Mobile-only fixed bottom navigation bar.
 *
 * Design goals:
 *  - Matches the reference mockup: 5 tabs with the center "Bet Slip" tab
 *    visually elevated in a circular button and decorated with a yellow
 *    count badge.
 *  - Only rendered on phone-sized viewports (`md:hidden`, i.e. <768px).
 *    At tablet/desktop widths the existing floating betslip button and
 *    inline sidebar take over, so this component stays completely hidden
 *    to avoid altering the current desktop/tablet experience.
 *  - Side-effect-free with respect to the rest of the app. Tapping
 *    "Bet Slip" and "Menu" dispatches CustomEvents (`1birr:open-betslip`
 *    and `1birr:toggle-menu`) which the existing `Betslip` drawer and
 *    `Header` component listen for. All other tabs are plain `<Link>`s so
 *    routing behaviour is unchanged.
 */

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Home as HomeIcon,
  Trophy,
  ClipboardList,
  Menu as MenuIcon,
  Receipt,
} from "lucide-react";
import { useBets } from "@/context/BetContext";

export default function MobileBottomNav() {
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const { bets } = useBets();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  };

  const openBetslip = () => {
    if (typeof window === "undefined") return;
    // Close the mobile menu drawer if it happens to be open, then ask the
    // Betslip drawer to open. If Betslip is not mounted on the current page
    // (e.g. stand-alone game pages), fall back to routing home where it is.
    window.dispatchEvent(new Event("1birr:close-menu"));
    window.dispatchEvent(new Event("1birr:open-betslip"));
  };

  // Tapping "Menu" opens the dedicated sports filter sidebar (which
  // mirrors the desktop left sidebar). On tablets the Header hamburger
  // still provides full navigation; on phones the other bottom-nav tabs
  // already cover Home / Sports / My Bets / Bet Slip, so surfacing the
  // filter sidebar here matches what users expect after the desktop UX.
  const openSportsSidebar = () => {
    if (typeof window === "undefined") return;
    // Close any other drawers that might be open so only one UI layer
    // is active at a time.
    window.dispatchEvent(new Event("1birr:close-menu"));
    window.dispatchEvent(new Event("1birr:open-sports-sidebar"));
  };

  // Shared layout for the four flat tabs (everything except the raised
  // Bet Slip button in the middle).
  const tabBase =
    "flex flex-col items-center justify-center gap-0.5 flex-1 min-w-0 h-full touch-target no-select";
  const iconBase = "w-5 h-5";
  const labelBase = "text-[10px] font-semibold tracking-wide leading-none";
  const activeColor = "var(--mezzo-accent-yellow)";
  const inactiveColor = "#cbd5e1"; // slate-300

  const tabColor = (active: boolean) => (active ? activeColor : inactiveColor);

  return (
    <nav
      aria-label="Primary mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t backdrop-blur-sm"
      style={{
        background: "var(--mezzo-bg-secondary)",
        borderColor: "var(--mezzo-border)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="relative flex items-stretch h-16">
        {/* Home */}
        <Link
          href="/"
          aria-label="Home"
          aria-current={isActive("/") ? "page" : undefined}
          className={tabBase}
        >
          <HomeIcon className={iconBase} style={{ color: tabColor(isActive("/")) }} />
          <span className={labelBase} style={{ color: tabColor(isActive("/")) }}>
            Home
          </span>
          {isActive("/") && (
            <span
              aria-hidden="true"
              className="absolute top-0 h-[3px] w-10 rounded-full"
              style={{ background: activeColor, left: "10%" }}
            />
          )}
        </Link>

        {/* Sports */}
        <Link
          href="/sport"
          aria-label="Sports"
          aria-current={isActive("/sport") ? "page" : undefined}
          className={tabBase}
        >
          <Trophy
            className={iconBase}
            style={{ color: tabColor(isActive("/sport")) }}
          />
          <span
            className={labelBase}
            style={{ color: tabColor(isActive("/sport")) }}
          >
            Sports
          </span>
        </Link>

        {/* Bet Slip (elevated circular button) */}
        <div className="flex-1 flex items-start justify-center">
          <button
            type="button"
            onClick={openBetslip}
            aria-label={`Open Bet Slip${bets.length ? ` (${bets.length} selections)` : ""}`}
            className="relative -top-5 w-[64px] h-[64px] rounded-full flex flex-col items-center justify-center shadow-lg touch-target no-select transition-transform active:scale-95"
            style={{
              background: "var(--mezzo-bg-tertiary)",
              border: "3px solid var(--mezzo-bg-primary)",
            }}
          >
            <Receipt className="w-5 h-5 text-white" />
            <span className="text-[10px] font-semibold text-white mt-0.5 leading-none">
              Bet Slip
            </span>
            {bets.length > 0 && (
              <span
                className="absolute -top-1 -right-1 min-w-[22px] h-[22px] px-1 rounded-full flex items-center justify-center text-[11px] font-bold border-2"
                style={{
                  background: "var(--mezzo-accent-yellow)",
                  color: "#000",
                  borderColor: "var(--mezzo-bg-secondary)",
                }}
              >
                {bets.length}
              </span>
            )}
          </button>
        </div>

        {/* My Bets — the user's own ticket history (won/lost/pending/
            cancelled with date-range search). */}
        <button
          type="button"
          onClick={() => router.push("/bets-history")}
          aria-label="My Bets"
          aria-current={isActive("/bets-history") ? "page" : undefined}
          className={tabBase}
        >
          <ClipboardList
            className={iconBase}
            style={{ color: tabColor(isActive("/bets-history")) }}
          />
          <span
            className={labelBase}
            style={{ color: tabColor(isActive("/bets-history")) }}
          >
            My Bets
          </span>
        </button>

        {/* Menu — opens the Sports & Leagues sidebar (desktop-parity filter) */}
        <button
          type="button"
          onClick={openSportsSidebar}
          aria-label="Open sports and leagues sidebar"
          className={tabBase}
        >
          <MenuIcon className={iconBase} style={{ color: inactiveColor }} />
          <span className={labelBase} style={{ color: inactiveColor }}>
            Menu
          </span>
        </button>
      </div>
    </nav>
  );
}
