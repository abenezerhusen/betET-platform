"use client";

/**
 * Desktop left sidebar — renders the shared `SportsCatalog` navigation
 * inside a fixed-width aside. The visuals and behaviour are identical to
 * the previous inline implementation; the catalog was extracted into
 * `SportsCatalog` so the mobile menu can reuse the exact same UI.
 */

import { ScrollArea } from "@/components/ui/scroll-area";
import { SportsCatalog } from "@/components/SportsCatalog";

export function LeftSidebarSports() {
  return (
    <aside
      className="hidden md:block md:w-48 lg:w-52 flex-shrink-0 border-r"
      style={{
        background: "var(--mezzo-bg-secondary)",
        borderColor: "var(--mezzo-border)",
      }}
    >
      <ScrollArea className="h-[calc(100vh-120px)]">
        <SportsCatalog />
      </ScrollArea>
    </aside>
  );
}
