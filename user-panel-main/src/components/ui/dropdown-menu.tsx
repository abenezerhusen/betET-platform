"use client";

import * as React from "react";

const DropdownContext = React.createContext<{ open: boolean; setOpen: (open: boolean) => void } | undefined>(undefined);

export function DropdownMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  return <DropdownContext.Provider value={{ open, setOpen }}><div className="relative inline-block">{children}</div></DropdownContext.Provider>;
}

export function DropdownMenuTrigger({ asChild, children }: { asChild?: boolean; children: React.ReactNode }) {
  const context = React.useContext(DropdownContext);
  if (!context) throw new Error("DropdownMenuTrigger must be used within DropdownMenu");

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, { onClick: () => context.setOpen(!context.open) } as any);
  }
  return <button onClick={() => context.setOpen(!context.open)}>{children}</button>;
}

export function DropdownMenuContent({ children, className = "", style, ...props }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  const context = React.useContext(DropdownContext);
  if (!context) throw new Error("DropdownMenuContent must be used within DropdownMenu");
  if (!context.open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => context.setOpen(false)} />
      <div className={`absolute right-0 z-50 mt-2 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md ${className}`} style={style} {...props}>
        {children}
      </div>
    </>
  );
}

export function DropdownMenuItem({ asChild, children, className = "", ...props }: { asChild?: boolean; children: React.ReactNode; className?: string; onClick?: () => void }) {
  const context = React.useContext(DropdownContext);

  const handleClick = (e: React.MouseEvent) => {
    if (props.onClick) props.onClick();
    context?.setOpen(false);
  };

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children, { onClick: handleClick, className: `relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground ${className}` } as any);
  }

  return <div className={`relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground ${className}`} onClick={handleClick} {...props}>{children}</div>;
}
