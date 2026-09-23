'use client';

/**
 * Root error boundary for the user panel.
 *
 * Next.js renders THIS component (replacing the whole document, including the
 * root layout and every provider) whenever a client-side exception escapes the
 * app — for example an error thrown inside a top-level provider in
 * `layout.tsx`, or a `ChunkLoadError` after a new deploy leaves a tab holding
 * references to `_next/static` chunks that no longer exist on the server.
 *
 * Before this file existed, such an exception produced Next.js's bare
 * "Application error: a client-side exception has occurred" page with no way to
 * recover, and — for deploy/stale-chunk cases — it could persist until the user
 * manually cleared their cache.
 *
 * This boundary is additive: it is only ever shown when the app would otherwise
 * be dead. It does not change any existing screen, flow, or design. On a
 * stale-chunk error it performs a single automatic hard reload to pull the new
 * build; for anything else it offers a "Try again" / reload action.
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

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    // Stale-deploy self-heal: force ONE hard reload to fetch the fresh build.
    // Guarded via sessionStorage so we never loop if the reload doesn't help.
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
    // Prefer Next's in-place recovery; fall back to a full reload.
    try {
      reset();
    } catch {
      window.location.reload();
    }
  };

  // Inline styles only: global-error replaces the root layout, so global CSS /
  // Tailwind classes are not guaranteed to be present here.
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0b1120',
          color: '#e5e7eb',
          fontFamily:
            'system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
          padding: '24px',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 8px' }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, lineHeight: 1.5, color: '#9ca3af', margin: '0 0 20px' }}>
            The page failed to load. This can happen after an update. Reloading
            usually fixes it.
          </p>
          <button
            type="button"
            onClick={handleReload}
            style={{
              display: 'inline-block',
              background: '#22c55e',
              color: '#052e16',
              border: 'none',
              borderRadius: 8,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
