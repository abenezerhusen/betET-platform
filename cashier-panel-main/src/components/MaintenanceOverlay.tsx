"use client";

import { useCallback, useEffect, useState } from "react";
import { getPublicMaintenance, type PublicMaintenance } from "@/lib/api";

const POLL_MS = 30_000;

/**
 * Full-screen overlay when admin enables site maintenance mode.
 * Blocks cashier operations until maintenance is turned off.
 */
export function MaintenanceOverlay() {
  const [state, setState] = useState<PublicMaintenance | null>(null);

  const refresh = useCallback(() => {
    void getPublicMaintenance()
      .then(setState)
      .catch(() => {
        /* keep last known state on transient errors */
      });
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  if (!state?.active) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 px-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="maintenance-title"
      aria-describedby="maintenance-message"
    >
      <div className="max-w-md w-full rounded-xl bg-white p-8 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-2xl">
          ⚙️
        </div>
        <h2 id="maintenance-title" className="text-xl font-semibold text-gray-900">
          Under Maintenance
        </h2>
        <p id="maintenance-message" className="mt-3 text-sm text-gray-600 leading-relaxed">
          {state.message}
        </p>
        <p className="mt-4 text-xs text-gray-400">
          Cashier operations are temporarily unavailable. Please wait until maintenance is complete.
        </p>
      </div>
    </div>
  );
}
