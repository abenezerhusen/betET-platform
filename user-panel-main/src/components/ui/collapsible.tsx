"use client";

import * as React from "react";

const CollapsibleContext = React.createContext<{ open: boolean; onOpenChange: (open: boolean) => void } | undefined>(undefined);

export function Collapsible({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: React.ReactNode }) {
  return <CollapsibleContext.Provider value={{ open, onOpenChange }}><div>{children}</div></CollapsibleContext.Provider>;
}

export function CollapsibleTrigger({ asChild, children }: { asChild?: boolean; children: React.ReactNode }) {
  const context = React.useContext(CollapsibleContext);
  if (!context) throw new Error("CollapsibleTrigger must be used within Collapsible");

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, { onClick: () => context.onOpenChange(!context.open) } as any);
  }
  return <button onClick={() => context.onOpenChange(!context.open)}>{children}</button>;
}

export function CollapsibleContent({ children }: { children: React.ReactNode }) {
  const context = React.useContext(CollapsibleContext);
  if (!context) throw new Error("CollapsibleContent must be used within Collapsible");
  if (!context.open) return null;
  return <div>{children}</div>;
}
