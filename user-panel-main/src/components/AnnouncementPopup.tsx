'use client';

import { useEffect, useState } from 'react';
import { getPublicAnnouncement, type PublicAnnouncement } from '@/lib/api/publicConfig';

/**
 * Admin-controlled promo / welcome popup shown on the user panel home page.
 * Enabled and edited from Admin → Settings → General → Announcement Popup.
 *
 * Display frequency (per browser) is honoured client-side:
 *   - always  → shows on every visit
 *   - session → shows once per browser tab session
 *   - daily   → shows once per calendar day
 * A content signature is part of the "seen" key, so editing the message in
 * the admin panel re-shows the popup even to users who dismissed the old one.
 */

const STORAGE_KEY = 'announcement_seen';

/** Small stable signature of the visible content (not cryptographic). */
function signature(a: PublicAnnouncement): string {
  const raw = [a.title, a.message, a.image_url, a.button_text, a.button_url].join('\u0001');
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash * 31 + raw.charCodeAt(i)) | 0;
  }
  return String(hash >>> 0);
}

function alreadySeen(a: PublicAnnouncement): boolean {
  if (typeof window === 'undefined') return false;
  const sig = signature(a);
  try {
    if (a.frequency === 'always') return false;
    if (a.frequency === 'daily') {
      const today = new Date().toISOString().slice(0, 10);
      return window.localStorage.getItem(STORAGE_KEY) === `${sig}|${today}`;
    }
    // default: session
    return window.sessionStorage.getItem(STORAGE_KEY) === sig;
  } catch {
    return false;
  }
}

function markSeen(a: PublicAnnouncement): void {
  if (typeof window === 'undefined') return;
  const sig = signature(a);
  try {
    if (a.frequency === 'daily') {
      const today = new Date().toISOString().slice(0, 10);
      window.localStorage.setItem(STORAGE_KEY, `${sig}|${today}`);
    } else if (a.frequency !== 'always') {
      window.sessionStorage.setItem(STORAGE_KEY, sig);
    }
  } catch {
    /* storage unavailable (private mode) — just skip persistence */
  }
}

export function AnnouncementPopup() {
  const [data, setData] = useState<PublicAnnouncement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getPublicAnnouncement()
      .then((a) => {
        if (cancelled) return;
        if (!a?.enabled) return;
        if (!(a.title || a.message || a.image_url)) return; // nothing to show
        setData(a);
        if (!alreadySeen(a)) setOpen(true);
      })
      .catch(() => {
        /* ignore — never block the page on the popup */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!open || !data) return null;

  const close = () => {
    markSeen(data);
    setOpen(false);
  };

  const onButton = () => {
    const url = (data.button_url ?? '').trim();
    markSeen(data);
    setOpen(false);
    if (!url) return;
    if (/^https?:\/\//i.test(url)) {
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      window.location.href = url;
    }
  };

  const hasButton = Boolean((data.button_text ?? '').trim());

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/70 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-title"
      onClick={close}
    >
      <div
        className="relative w-full max-w-md overflow-hidden rounded-2xl bg-[#0f1720] text-white shadow-2xl ring-1 ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white/80 hover:bg-black/60 hover:text-white"
        >
          ✕
        </button>

        {data.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.image_url}
            alt={data.title ?? 'Announcement'}
            className="max-h-56 w-full object-cover"
          />
        ) : null}

        <div className="space-y-3 p-6">
          {data.title ? (
            <h2 id="announcement-title" className="text-xl font-bold text-green-400">
              {data.title}
            </h2>
          ) : null}
          {data.message ? (
            <p className="whitespace-pre-line text-sm leading-relaxed text-gray-200">
              {data.message}
            </p>
          ) : null}

          {hasButton ? (
            <button
              type="button"
              onClick={onButton}
              className="mt-2 w-full rounded-lg bg-green-500 px-4 py-3 text-center text-sm font-bold text-black transition hover:bg-green-400"
            >
              {data.button_text}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
