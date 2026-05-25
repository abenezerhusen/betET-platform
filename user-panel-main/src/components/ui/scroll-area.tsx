"use client";

import * as React from "react";

export function ScrollArea({ children, className = "", ...props }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`relative overflow-auto ${className}`} {...props}>
      {children}
    </div>
  );
}
