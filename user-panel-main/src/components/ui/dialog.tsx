"use client";

import * as React from "react";
import { createPortal } from "react-dom";

/**
 * Dialog
 * ---------------------------------------------------------------------------
 * Renders the modal through a portal mounted on `document.body`. This is what
 * keeps the dialog truly centered on the viewport regardless of which parent
 * mounts it. (Previously the modal was placed in-tree, which caused it to be
 * constrained inside ancestors that establish a containing block via `transform`
 * — e.g. the right-side Bet Slip aside — making it appear stuck on the right.)
 *
 * The visual styling, sizing, and behaviour of every consumer is unchanged.
 * Only the DOM mount point moved.
 */
export function Dialog({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}) {
  // `createPortal` requires a DOM target, so we gate rendering until after
  // mount on the client. Server-rendering returns null which is correct for
  // a closed-by-default modal.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => {
    setMounted(true);
  }, []);

  if (!open || !mounted || typeof document === "undefined") return null;

  return createPortal(
    <div
      data-pc-print-root="true"
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-4"
    >
      <div
        className="fixed inset-0 bg-black/90 no-print"
        onClick={() => onOpenChange(false)}
      />
      {children}
    </div>,
    document.body,
  );
}

export function DialogContent({
  children,
  className = "",
  ...props
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`relative z-[101] grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg sm:rounded-lg ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function DialogHeader({
  children,
  className = "",
  ...props
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col space-y-1.5 text-center sm:text-left ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

export function DialogTitle({
  children,
  className = "",
  ...props
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h2
      className={`text-lg font-semibold leading-none tracking-tight ${className}`}
      {...props}
    >
      {children}
    </h2>
  );
}
