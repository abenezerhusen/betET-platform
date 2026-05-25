"use client";

/**
 * `/transaction-history` — Section 15.
 *
 * Data: GET /api/user/me/transactions?page=1&limit=30
 *
 * Surfaces all wallet movements (deposits, withdrawals, bet stakes,
 * payouts, bonus credits, P2P transfers, etc.). The original mock UI
 * is preserved; we just feed it real records.
 */

import { useEffect, useState } from "react";
import { Betslip } from "@/components/Betslip";
import { ArrowUpCircle, ArrowDownCircle } from "lucide-react";
import { profileApi } from "@/lib/api";
import type { TransactionItem } from "@/lib/api/types";

interface DisplayTx {
  id: string;
  /** "deposit" if the row is incoming money, "withdraw" otherwise. */
  direction: "deposit" | "withdraw";
  rawType: string;
  amount: number;
  method: string;
  date: string;
  status: string;
}

function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function relativeDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const dayDiff = Math.floor(diffMs / dayMs);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (dayDiff === 0) return `Today ${time}`;
  if (dayDiff === 1) return `Yesterday ${time}`;
  if (dayDiff < 7) return `${dayDiff} days ago`;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()} ${time}`;
}

function prettyMethod(t: TransactionItem): string {
  if (t.payment_method) return t.payment_method;
  if (t.description) return t.description;
  if (t.reference) return t.reference;
  return t.type.replace(/_/g, " ");
}

function isIncoming(type: string, amount: number): boolean {
  const t = (type ?? "").toLowerCase();
  // Explicit deposit/credit-style types are always incoming. Otherwise
  // fall back to the sign of the amount (>= 0 → incoming).
  if (
    t === "deposit" ||
    t === "credit" ||
    t === "bonus" ||
    t === "win" ||
    t === "refund" ||
    t === "transfer_in" ||
    t === "p2p_receive"
  ) {
    return true;
  }
  if (
    t === "withdraw" ||
    t === "withdrawal" ||
    t === "bet" ||
    t === "transfer_out" ||
    t === "p2p_send"
  ) {
    return false;
  }
  return amount >= 0;
}

function toDisplay(t: TransactionItem): DisplayTx {
  const amount = toNumber(t.amount);
  return {
    id: t.id,
    direction: isIncoming(t.type, amount) ? "deposit" : "withdraw",
    rawType: t.type,
    amount: Math.abs(amount),
    method: prettyMethod(t),
    date: relativeDate(t.created_at),
    status: (t.status ?? "completed").replace(/_/g, " "),
  };
}

export default function TransactionHistoryPage() {
  const [rows, setRows] = useState<DisplayTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    profileApi
      .listTransactions({ page: 1, limit: 30 })
      .then((res) => {
        if (cancelled) return;
        setRows((res.items ?? []).map(toDisplay));
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message ?? "Failed to load transactions");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <div className="flex-1" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="p-6">
          <h1 className="text-2xl font-bold mb-6">Transaction History</h1>

          {loading ? (
            <div className="p-10 text-center text-gray-400 text-sm">
              Loading your transactions…
            </div>
          ) : error ? (
            <div className="p-10 text-center text-red-400 text-sm">{error}</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-gray-400 text-sm">
              No transactions yet.
            </div>
          ) : (
            <div className="space-y-3">
              {rows.map((tx) => (
                <div
                  key={tx.id}
                  className="flex items-center justify-between p-4 rounded-lg"
                  style={{ background: "var(--mezzo-bg-secondary)" }}
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`p-2 rounded-full ${
                        tx.direction === "deposit" ? "bg-green-500/20" : "bg-red-500/20"
                      }`}
                    >
                      {tx.direction === "deposit" ? (
                        <ArrowDownCircle className="w-5 h-5 text-green-500" />
                      ) : (
                        <ArrowUpCircle className="w-5 h-5 text-red-500" />
                      )}
                    </div>
                    <div>
                      <div className="font-semibold capitalize">{tx.rawType.replace(/_/g, " ")}</div>
                      <div className="text-sm text-gray-400">{tx.method}</div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className={`font-semibold ${tx.direction === "deposit" ? "text-green-500" : "text-red-500"}`}>
                      {tx.direction === "deposit" ? "+" : "-"}
                      {tx.amount.toFixed(2)} ETB
                    </div>
                    <div className="text-sm text-gray-400">{tx.date}</div>
                    <div className="text-xs mt-1">
                      <span
                        className={`px-2 py-0.5 rounded ${
                          tx.status.toLowerCase() === "completed"
                            ? "bg-green-500/20 text-green-500"
                            : tx.status.toLowerCase() === "failed" || tx.status.toLowerCase() === "rejected"
                              ? "bg-red-500/20 text-red-500"
                              : "bg-yellow-500/20 text-yellow-500"
                        }`}
                      >
                        {tx.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Betslip />
    </div>
  );
}
