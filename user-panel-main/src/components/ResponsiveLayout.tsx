"use client";

import { useState } from "react";
import { Betslip } from "@/components/Betslip";
import { ShoppingCart, X } from "lucide-react";
import { useBets } from "@/context/BetContext";

interface ResponsiveLayoutProps {
  children: React.ReactNode;
  showBetslip?: boolean;
}

export function ResponsiveLayout({ children, showBetslip = true }: ResponsiveLayoutProps) {
  const [mobileBetslipOpen, setMobileBetslipOpen] = useState(false);
  const { bets } = useBets();

  return (
    <div className="flex min-h-[calc(100vh-180px)] relative">
      {/* Main Content */}
      <div className={`flex-1 ${showBetslip ? 'lg:mr-0' : ''}`}>
        {children}
      </div>

      {/* Desktop Betslip - Always visible on large screens */}
      {showBetslip && (
        <div className="hidden lg:block">
          <Betslip />
        </div>
      )}

      {/* Mobile Betslip Toggle Button */}
      {showBetslip && (
        <>
          <button
            onClick={() => setMobileBetslipOpen(true)}
            className="lg:hidden fixed bottom-4 right-4 z-40 p-4 rounded-full shadow-lg flex items-center gap-2 font-bold"
            style={{ background: "var(--mezzo-accent-green)", color: "#000" }}
          >
            <ShoppingCart className="w-6 h-6" />
            {bets.length > 0 && (
              <span className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: "var(--mezzo-accent-yellow)", color: "#000" }}>
                {bets.length}
              </span>
            )}
          </button>

          {/* Mobile Betslip Overlay */}
          {mobileBetslipOpen && (
            <>
              {/* Backdrop */}
              <div
                className="lg:hidden fixed inset-0 bg-black/60 z-50"
                onClick={() => setMobileBetslipOpen(false)}
              />

              {/* Betslip Drawer */}
              <div className="lg:hidden fixed inset-y-0 right-0 w-full sm:w-96 z-50 shadow-xl">
                <div className="relative h-full">
                  <button
                    onClick={() => setMobileBetslipOpen(false)}
                    className="absolute top-4 left-4 z-10 p-2 rounded-full bg-gray-800 text-white"
                  >
                    <X className="w-5 h-5" />
                  </button>
                  <Betslip onClose={() => setMobileBetslipOpen(false)} />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
