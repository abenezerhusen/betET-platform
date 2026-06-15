"use client";

/**
 * Mobile sports-filter sidebar drawer.
 *
 * Opened by the "Menu" tab in the `MobileBottomNav`, this drawer slides
 * in from the left and renders the exact same `SportsCatalog` used by
 * the desktop `LeftSidebarSports`. The goal is parity with desktop: a
 * user on a phone who wants to drill into e.g. `England → Premier
 * League` now gets the identical navigation they have on desktop, just
 * inside a drawer rather than a fixed aside.
 *
 * Listens for:
 *   - `1birr:open-sports-sidebar`  — open the drawer
 *   - `1birr:close-sports-sidebar` — close the drawer (optional)
 *
 * The component is a no-op on `lg+` breakpoints (desktop already shows
 * the sidebar inline), so it never interferes with the existing desktop
 * layout. Body scroll is locked while the drawer is open, and any
 * selection inside the catalog auto-closes the drawer before navigating.
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { SportsCatalog } from "@/components/SportsCatalog";

export default function MobileSportsSidebar() {
  const [open, setOpen] = useState(false);

  // Wire up the public event API. Kept intentionally small so other
  // components (MobileBottomNav today, anything else tomorrow) can open
  // this drawer without importing state or prop-drilling.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOpen = () => setOpen(true);
    const handleClose = () => setOpen(false);
    window.addEventListener("1birr:open-sports-sidebar", handleOpen);
    window.addEventListener("1birr:close-sports-sidebar", handleClose);
    return () => {
      window.removeEventListener("1birr:open-sports-sidebar", handleOpen);
      window.removeEventListener("1birr:close-sports-sidebar", handleClose);
    };
  }, []);

  // Auto-close the drawer when the viewport grows to desktop so it
  // never stays mounted off-screen after a rotate/resize.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setOpen(false);
    };
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  // Lock page scroll while the drawer is open so the content behind
  // doesn't scroll with the catalog.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [open]);

  // Dismiss the drawer with Escape for keyboard users.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Backdrop — only rendered while open so it doesn't block pointer
          events on the rest of the page the other 99% of the time. */}
      {open && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-50"
          onClick={() => setOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        role="dialog"
        aria-label="Browse sports and leagues"
        aria-hidden={!open}
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-[85vw] max-w-xs sm:max-w-sm
          transform transition-transform duration-300 ease-out
          ${open ? "translate-x-0" : "-translate-x-full"}
          border-r flex flex-col safe-area-inset`}
        style={{
          background: "var(--mezzo-bg-secondary)",
          borderColor: "var(--mezzo-border)",
        }}
      >
        {/* Drawer header */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: "var(--mezzo-border)" }}
        >
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-[var(--mezzo-accent-yellow)]"
              fill="currentColor"
              viewBox="0 0 20 20"
              aria-hidden="true"
            >
              <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
            </svg>
            <span className="text-sm font-bold tracking-wide text-white">
              SPORTS &amp; LEAGUES
            </span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close sports sidebar"
            className="p-2 rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors touch-target"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable catalog body — mirrors the desktop left sidebar
            scroll region. `onNavigate` closes the drawer after routing. */}
        <div className="flex-1 overflow-y-auto">
          <SportsCatalog onNavigate={() => setOpen(false)} />
        </div>
      </aside>
    </>
  );
}
