"use client"

import { useCallback, useRef, useState } from "react"

/**
 * Small, design-neutral toast used by the internal games to surface wallet
 * errors (primarily "Insufficient balance") without disrupting each game's
 * bespoke layout. Returns a `notify` callback and the `toast` element to
 * render anywhere inside the page tree.
 */
export function useBalanceToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const notify = useCallback((msg = "Insufficient balance — please deposit") => {
    setMessage(msg)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timeoutRef.current = setTimeout(() => setMessage(null), 2600)
  }, [])

  const toast = message ? (
    <div
      role="alert"
      style={{
        position: "fixed",
        top: 16,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 99999,
        background: "linear-gradient(135deg, #e11d48, #b91c1c)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        pointerEvents: "none",
      }}
      className="px-5 py-2.5 rounded-lg text-sm font-bold text-white"
    >
      {message}
    </div>
  ) : null

  return { notify, toast }
}
