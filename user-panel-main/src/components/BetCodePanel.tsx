"use client";

import { Search, Ticket, X } from "lucide-react";

/* -------------------------------------------------------------------------- */
/* BetCodePanel                                                                */
/*                                                                            */
/* Shared "Bet Code" + "Check Coupon" panel rendered both above the slip on   */
/* phones (`xl:hidden`) and below the slip on desktop (`hidden xl:block`)     */
/* so it is always visible regardless of whether the slip currently holds     */
/* any picks. This is the "friend shares a code with me" entry point — the    */
/* user pastes a friend's bet code, the slip is populated with the friend's   */
/* still-replayable picks, and the user can edit (remove / add picks) and     */
/* place the modified slip as their own brand-new bet.                        */
/* -------------------------------------------------------------------------- */

export interface BetCodePanelProps {
  /**
   * Tailwind classes that control where this instance renders. Typical
   * values are `"xl:hidden border-b shrink-0"` (mobile, above the slip)
   * or `"hidden xl:block border-t shrink-0"` (desktop, below the slip).
   */
  layoutClass: string;
  ticketNumber: string;
  onTicketChange: (v: string) => void;
  onLoad: () => void | Promise<void>;
  loading: boolean;
  couponNumber: string;
  onCouponChange: (v: string) => void;
  onCheck: () => void;
  loadInfo: { kind: "ok" | "warn" | "err"; text: string } | null;
  onDismissLoadInfo: () => void;
}

const INFO_COLORS: Record<"ok" | "warn" | "err", string> = {
  ok: "border-green-500/40 bg-green-500/10 text-green-300",
  warn: "border-yellow-500/40 bg-yellow-500/10 text-yellow-200",
  err: "border-red-500/40 bg-red-500/10 text-red-300",
};

export function BetCodePanel({
  layoutClass,
  ticketNumber,
  onTicketChange,
  onLoad,
  loading,
  couponNumber,
  onCouponChange,
  onCheck,
  loadInfo,
  onDismissLoadInfo,
}: BetCodePanelProps) {
  return (
    <div
      className={layoutClass}
      style={{
        borderColor: "var(--mezzo-border)",
        background: "var(--mezzo-bg-secondary)",
      }}
    >
      <div
        className="px-3 pt-3 pb-2 border-b"
        style={{ borderColor: "var(--mezzo-border)" }}
      >
        <div className="flex items-center gap-1.5 mb-1">
          <Ticket className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span className="text-[11px] font-bold text-gray-200 tracking-wide">
            BET CODE
          </span>
        </div>
        <p className="text-[11px] text-gray-400 mb-2">
          Got a code from a friend? Paste it here to load their picks into
          your slip — then edit it and place your own bet.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="text"
            placeholder="Bet code (e.g. SBK-XXXXXXXX) ..."
            value={ticketNumber}
            onChange={(e) => onTicketChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ticketNumber.trim() && !loading) {
                void onLoad();
              }
            }}
            className="flex-1 min-w-0 px-3 py-2 rounded bg-[#2a2a4a] border border-gray-700 text-white text-sm outline-none focus:border-purple-500 transition-colors placeholder:text-gray-500"
          />
          <button
            type="button"
            onClick={() => void onLoad()}
            disabled={loading || !ticketNumber.trim()}
            className="shrink-0 px-4 py-2 rounded font-bold text-sm transition-all hover:opacity-80 disabled:opacity-60 disabled:cursor-not-allowed touch-target"
            style={{
              background: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
              color: "#fff",
            }}
          >
            {loading ? "..." : "LOAD"}
          </button>
        </div>
        {loadInfo && (
          <div
            className={`mt-2 flex items-start gap-2 px-2.5 py-2 rounded border text-[11px] ${INFO_COLORS[loadInfo.kind]}`}
            role="status"
          >
            <span className="flex-1">{loadInfo.text}</span>
            <button
              type="button"
              onClick={onDismissLoadInfo}
              className="opacity-70 hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      <div className="px-3 py-2">
        <div className="flex items-center gap-1.5 mb-1">
          <Search className="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span className="text-[11px] font-bold text-gray-200 tracking-wide">
            CHECK COUPON
          </span>
        </div>
        <p className="text-[11px] text-gray-400 mb-2">
          Enter a coupon number to view its status.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            inputMode="text"
            placeholder="Coupon number ..."
            value={couponNumber}
            onChange={(e) => onCouponChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && couponNumber.trim()) {
                onCheck();
              }
            }}
            className="flex-1 min-w-0 px-3 py-2 rounded bg-[#2a2a4a] border border-gray-700 text-white text-sm outline-none focus:border-purple-500 transition-colors placeholder:text-gray-500"
          />
          <button
            type="button"
            onClick={onCheck}
            disabled={!couponNumber.trim()}
            className="shrink-0 px-4 py-2 rounded font-bold text-sm transition-all hover:opacity-80 disabled:opacity-60 disabled:cursor-not-allowed touch-target"
            style={{
              background: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
              color: "#fff",
            }}
          >
            CHECK
          </button>
        </div>
      </div>
    </div>
  );
}
