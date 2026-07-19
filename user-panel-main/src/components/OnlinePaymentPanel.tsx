"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, AlertCircle, Lock, Smartphone, RefreshCw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { gatewayApi } from "@/lib/api";
import type { GatewayMethod } from "@/lib/api/gateway";

/**
 * Online Payment panel — a single, admin-driven gateway UI used for both
 * Deposit and Withdrawal. Enabled methods, limits and the phone-edit
 * permission all come from the backend (Admin Payment Configuration).
 *
 * Fully independent of the Telebirr P2P and Branch flows.
 */
export function OnlinePaymentPanel({
  channel,
  balance,
  refreshWallet,
}: {
  channel: "deposit" | "withdrawal";
  /** Available balance cap for withdrawals (ignored for deposits). */
  balance?: number;
  refreshWallet: () => Promise<void>;
}) {
  const { user } = useAuth();
  const [methods, setMethods] = useState<GatewayMethod[]>([]);
  const [allowPhoneEdit, setAllowPhoneEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  const load = () => {
    setLoading(true);
    setLoadErr("");
    gatewayApi
      .getGatewayConfig(channel)
      .then((cfg) => {
        setMethods(cfg.methods);
        setAllowPhoneEdit(cfg.allow_phone_number_editing);
        setPhone(cfg.phone ?? user?.phone ?? "");
        setSelected((prev) =>
          prev && cfg.methods.some((m) => m.provider_slug === prev)
            ? prev
            : (cfg.methods[0]?.provider_slug ?? null)
        );
      })
      .catch((e) =>
        setLoadErr((e as Error).message || "Failed to load payment methods.")
      )
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  const method = useMemo(
    () => methods.find((m) => m.provider_slug === selected) ?? null,
    [methods, selected]
  );

  const parsed = Number(amount || 0);
  const min = method?.min_amount ? Number(method.min_amount) : 0;
  const max = method?.max_amount ? Number(method.max_amount) : Number.POSITIVE_INFINITY;
  const withinBalance =
    channel === "deposit" || balance === undefined || parsed <= balance;
  const canSubmit =
    !!method &&
    Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed >= (min || 0) &&
    parsed <= max &&
    withinBalance &&
    !!phone.trim() &&
    !busy;

  const submit = async () => {
    setErr("");
    setOkMsg("");
    if (!method) {
      setErr("Select a payment method first.");
      return;
    }
    if (!(parsed > 0)) {
      setErr("Enter a valid amount.");
      return;
    }
    if (min && parsed < min) {
      setErr(`Minimum amount is ${min} ETB.`);
      return;
    }
    if (parsed > max) {
      setErr(`Maximum amount is ${max} ETB.`);
      return;
    }
    if (!withinBalance) {
      setErr("Amount exceeds your available balance.");
      return;
    }
    setBusy(true);
    try {
      const input = {
        provider_slug: method.provider_slug,
        amount: String(parsed),
        ...(allowPhoneEdit ? { phone: phone.trim() } : {}),
      };
      const out =
        channel === "deposit"
          ? await gatewayApi.initiateGatewayDeposit(input)
          : await gatewayApi.initiateGatewayWithdrawal(input);
      // Future gateways may return a hosted-checkout URL to redirect to.
      if (out.redirect_url) {
        window.location.href = out.redirect_url;
        return;
      }
      const ref = out.reference ?? out.id.slice(0, 8);
      setOkMsg(
        channel === "deposit"
          ? `Deposit request created via ${out.method_name}. It will be credited once your payment is confirmed. (Ref: ${ref})`
          : `Withdrawal request submitted via ${out.method_name}. The amount is reserved and will be paid out to ${out.phone} shortly. (Ref: ${ref})`
      );
      setAmount("");
      await refreshWallet();
    } catch (e) {
      setErr((e as Error).message || "Request failed.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 rounded-lg text-sm text-gray-400" style={{ background: "var(--mezzo-bg-secondary)" }}>
        Loading payment methods…
      </div>
    );
  }

  if (loadErr) {
    return (
      <div className="p-4 rounded-lg space-y-3" style={{ background: "var(--mezzo-bg-secondary)" }}>
        <div className="text-sm text-red-400 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{loadErr}</span>
        </div>
        <Button
          variant="outline"
          onClick={load}
          className="h-8 border-gray-700 bg-transparent text-white hover:bg-gray-800 text-xs"
        >
          <RefreshCw className="w-3 h-3 mr-1" />
          Retry
        </Button>
      </div>
    );
  }

  if (methods.length === 0) {
    return (
      <div className="p-4 rounded-lg text-sm text-gray-400" style={{ background: "var(--mezzo-bg-secondary)" }}>
        No online payment methods are enabled right now. Please check back later.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="p-4 rounded-lg space-y-4" style={{ background: "var(--mezzo-bg-secondary)" }}>
        <h3 className="font-semibold text-sm">
          Online Payment {channel === "deposit" ? "Deposit" : "Withdrawal"}
        </h3>

        {/* Step 1 — choose a payment method */}
        <div>
          <label className="block text-xs text-gray-400 mb-2">Select payment method</label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {methods.map((m) => {
              const active = m.provider_slug === selected;
              return (
                <button
                  key={m.provider_slug}
                  type="button"
                  onClick={() => {
                    setSelected(m.provider_slug);
                    setErr("");
                    setOkMsg("");
                  }}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-md text-sm font-semibold transition-colors border ${
                    active
                      ? "bg-[var(--mezzo-accent-green)] text-black border-transparent"
                      : "text-gray-200 hover:text-white border-[var(--mezzo-border)]"
                  }`}
                  style={active ? undefined : { background: "var(--mezzo-bg-tertiary)" }}
                >
                  {m.logo_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.logo_url} alt="" className="w-5 h-5 rounded object-contain" />
                  ) : (
                    <Smartphone className="w-4 h-4 flex-shrink-0" />
                  )}
                  <span className="truncate">{m.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 2 — amount + phone + request */}
        {method && (
          <div className="space-y-3 pt-1">
            <div>
              <label className="block text-xs text-gray-400 mb-1">Amount (ETB)</label>
              <Input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-9 bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
              />
              {(method.min_amount || method.max_amount) && (
                <p className="text-[11px] text-gray-500 mt-1">
                  {method.min_amount ? `Min ${Number(method.min_amount)} ETB` : ""}
                  {method.min_amount && method.max_amount ? " · " : ""}
                  {method.max_amount ? `Max ${Number(method.max_amount)} ETB` : ""}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Phone Number{allowPhoneEdit ? "" : " (from your profile)"}
              </label>
              <Input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                readOnly={!allowPhoneEdit}
                placeholder="09XXXXXXXX"
                className={`h-9 bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white ${
                  allowPhoneEdit ? "" : "opacity-80"
                }`}
              />
              {!allowPhoneEdit && (
                <div className="text-[11px] text-gray-500 flex items-center gap-1 mt-1">
                  <Lock className="w-3 h-3" />
                  Synced from your profile.
                </div>
              )}
            </div>

            {err && <div className="text-xs text-red-400">{err}</div>}
            {okMsg && (
              <div className="px-3 py-2 rounded text-xs bg-green-500/15 border border-green-500/40 text-green-400 flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{okMsg}</span>
              </div>
            )}

            <Button
              onClick={() => void submit()}
              disabled={!canSubmit}
              className="w-full h-9 text-black font-semibold disabled:opacity-50"
              style={{ background: "var(--mezzo-accent-green)" }}
            >
              {busy ? "Submitting…" : "Request"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
