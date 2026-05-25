"use client";

import { Suspense, useEffect, useState } from "react";
import { Betslip } from "@/components/Betslip";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ApiError, gamesApi } from "@/lib/api";
import { useSearchParams } from "next/navigation";

type CouponResult = Awaited<ReturnType<typeof gamesApi.getCouponByCode>>;

function CouponCheckContent() {
  const searchParams = useSearchParams();
  const [couponCode, setCouponCode] = useState("");
  const [result, setResult] = useState<CouponResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const checkCoupon = async () => {
    const code = couponCode.trim();
    if (!code || loading) return;
    setLoading(true);
    setError("");
    setResult(null);
    try {
      const data = await gamesApi.getCouponByCode(code);
      setResult(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message || "Coupon not found");
      } else {
        setError("Coupon not found");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const code = searchParams.get("code")?.trim();
    if (!code) return;
    setCouponCode(code);
    void (async () => {
      setLoading(true);
      setError("");
      setResult(null);
      try {
        const data = await gamesApi.getCouponByCode(code);
        setResult(data);
      } catch (err) {
        if (err instanceof ApiError) {
          setError(err.message || "Coupon not found");
        } else {
          setError("Coupon not found");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [searchParams]);

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      {/* Coupon Check Content */}
      <div className="flex-1 flex items-start justify-center p-8" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="w-full max-w-2xl">
          <div className="p-6 rounded-lg" style={{ background: "var(--mezzo-bg-secondary)" }}>
            <h1 className="text-2xl font-bold mb-6 text-[var(--mezzo-accent-green)]">BET DETAILS</h1>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-2">Enter Bet ID</label>
                <div className="flex gap-2">
                  <Input
                    value={couponCode}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCouponCode(e.target.value)}
                    placeholder="Enter your bet ID here..."
                    className="flex-1 bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
                  />
                  <Button
                    onClick={() => void checkCoupon()}
                    disabled={loading || !couponCode.trim()}
                    className="text-black font-semibold px-8"
                    style={{ background: "var(--mezzo-accent-green)" }}
                  >
                    {loading ? "CHECKING..." : "CHECK"}
                  </Button>
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-red-400/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
                  {error}
                </div>
              )}

              {result && (
                <div className="rounded-md border border-[var(--mezzo-border)] bg-[var(--mezzo-bg-tertiary)] p-4 space-y-2 text-sm text-gray-300">
                  <div className="grid grid-cols-2 gap-3">
                    <p>
                      <span className="text-gray-400">Bet ID:</span> {result.bet_id}
                    </p>
                    <p>
                      <span className="text-gray-400">Status:</span> {result.status}
                    </p>
                    <p>
                      <span className="text-gray-400">Stake:</span> {result.stake} {result.currency}
                    </p>
                    <p>
                      <span className="text-gray-400">Potential:</span> {result.potential_win} {result.currency}
                    </p>
                    <p>
                      <span className="text-gray-400">Payout:</span>{" "}
                      {result.payout ? `${result.payout} ${result.currency}` : "-"}
                    </p>
                    <p>
                      <span className="text-gray-400">Placed:</span>{" "}
                      {new Date(result.placed_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}

              {/* Empty state */}
              {!couponCode && !result && !loading && !error && (
                <div className="text-center py-12">
                  <p className="text-gray-500">Enter a bet ID to check your coupon status</p>
                </div>
              )}
            </div>
          </div>

          {/* How to use */}
          <div className="mt-6 p-6 rounded-lg" style={{ background: "var(--mezzo-bg-secondary)" }}>
            <h3 className="font-bold mb-3">How to check your bet</h3>
            <div className="space-y-2 text-sm text-gray-400">
              <p>1. Enter your bet ID in the field above</p>
              <p>2. Click the "Check" button</p>
              <p>3. View your bet details and status</p>
              <p className="mt-4 text-xs text-gray-500">
                You can find your bet ID in your bet history or on your bet receipt
              </p>
            </div>
          </div>
        </div>
      </div>

      <Betslip />
    </div>
  );
}

export default function CouponCheckPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-400">Loading coupon check...</div>}>
      <CouponCheckContent />
    </Suspense>
  );
}
