'use client';

/**
 * Route-segment error boundary for the user panel.
 *
 * Unlike `global-error.tsx` (which replaces the whole document for
 * layout/provider-level crashes), this catches exceptions thrown while
 * rendering page content and renders INSIDE the existing root layout, so the
 * header, footer and navigation remain intact. It also self-heals from
 * stale-deploy `ChunkLoadError`s with a single automatic reload.
 *
 * Additive only: shown exclusively when a page would otherwise crash. No
 * existing screen, flow, or design is changed.
 */

import { useEffect } from 'react';

const RELOAD_GUARD_KEY = '1birr:chunk-reload-attempt';

function isChunkLoadError(error: (Error & { digest?: string }) | undefined): boolean {
  if (!error) return false;
  if (error.name === 'ChunkLoadError') return true;
  return /Loading chunk|dynamically imported module|Failed to fetch dynamically imported module|importing a module script failed|error loading dynamically imported module/i.test(
    error.message || ''
  );
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (isChunkLoadError(error)) {
      try {
        if (!window.sessionStorage.getItem(RELOAD_GUARD_KEY)) {
          window.sessionStorage.setItem(RELOAD_GUARD_KEY, '1');
          window.location.reload();
        }
      } catch {
        /* sessionStorage unavailable — fall through to the manual UI. */
      }
    }
  }, [error]);

  const handleReload = () => {
    try {
      window.sessionStorage.removeItem(RELOAD_GUARD_KEY);
    } catch {
      /* ignore */
    }
    try {
      reset();
    } catch {
      if (typeof window !== 'undefined') window.location.reload();
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="max-w-md text-center">
        <h1 className="text-lg font-bold text-gray-900">Something went wrong</h1>
        <p className="mt-2 text-sm text-gray-500">
          This page failed to load. This can happen after an update. Reloading
          usually fixes it.
        </p>
        <button
          type="button"
          onClick={handleReload}
          className="mt-5 inline-block rounded-lg bg-green-500 px-5 py-2.5 text-sm font-bold text-green-950 transition active:scale-95"
        >
          Reload
        </button>
      </div>
    </div>
  );
}
