"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Betslip } from "@/components/Betslip";
import {
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  RefreshCw,
  Copy,
  Landmark,
  Upload,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OnlinePaymentPanel } from "@/components/OnlinePaymentPanel";
import { useAuth } from "@/context/AuthContext";
import { walletApi } from "@/lib/api";

function OperationSwitcher() {
  const pathname = usePathname();
  const isDeposit = pathname?.startsWith("/deposit");
  return (
    <div className="inline-flex rounded-lg p-1 mb-4" style={{ background: "var(--mezzo-bg-secondary)" }}>
      <Link
        href="/deposit"
        className={`flex items-center gap-2 px-4 py-1.5 text-sm rounded-md font-semibold transition-colors ${
          isDeposit ? "bg-[var(--mezzo-accent-green)] text-black" : "text-gray-300 hover:text-white"
        }`}
      >
        <ArrowDownCircle className="w-4 h-4" />
        Deposit
      </Link>
      <Link
        href="/withdraw"
        className={`flex items-center gap-2 px-4 py-1.5 text-sm rounded-md font-semibold transition-colors ${
          !isDeposit ? "bg-[var(--mezzo-accent-green)] text-black" : "text-gray-300 hover:text-white"
        }`}
      >
        <ArrowUpCircle className="w-4 h-4" />
        Withdrawal
      </Link>
    </div>
  );
}

export default function DepositPage() {
  const { wallet, refreshWallet } = useAuth();
  const [activeTab, setActiveTab] = useState("p2p");
  const [historyCount, setHistoryCount] = useState(0);

  const balanceLine = wallet?.summary?.[0];
  const balance = Number(balanceLine?.balance ?? 0);
  const bonusBalance = Number(balanceLine?.bonus_balance ?? 0);

  useEffect(() => {
    walletApi
      .telebirrDepositHistory({ page: 1, limit: 5 })
      .then((res) => setHistoryCount(res.total ?? 0))
      .catch(() => setHistoryCount(0));
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <div className="flex-1 p-4 sm:p-6" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="max-w-3xl mx-auto">
          <OperationSwitcher />
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Wallet className="w-5 h-5 text-[var(--mezzo-accent-yellow)]" />
            <h1 className="text-xl font-bold">Deposit Funds</h1>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded" style={{ background: "var(--mezzo-bg-secondary)" }}>
                Balance: <span className="text-[var(--mezzo-accent-green)] font-semibold">{balance.toFixed(2)} ETB</span>
              </span>
              <span className="text-xs px-2 py-1 rounded" style={{ background: "var(--mezzo-bg-secondary)" }}>
                Bonus: <span className="text-[var(--mezzo-accent-yellow)] font-semibold">{bonusBalance.toFixed(2)} ETB</span>
              </span>
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3 mb-4 h-9" style={{ background: "var(--mezzo-bg-secondary)" }}>
              <TabsTrigger value="p2p" className="text-xs data-[state=active]:bg-[var(--mezzo-accent-green)] data-[state=active]:text-black">
                P2P Deposit
              </TabsTrigger>
              <TabsTrigger value="online" className="text-xs data-[state=active]:bg-[var(--mezzo-accent-green)] data-[state=active]:text-black">
                Online Payment
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs data-[state=active]:bg-[var(--mezzo-accent-green)] data-[state=active]:text-black">
                History ({historyCount})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="p2p" className="space-y-3">
              <P2PDepositPanel />
            </TabsContent>

            <TabsContent value="online" className="space-y-3">
              <OnlinePaymentPanel channel="deposit" refreshWallet={refreshWallet} />
            </TabsContent>

            <TabsContent value="history">
              <HistoryList />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Betslip />
    </div>
  );
}

function P2PDepositPanel() {
  const { refreshWallet } = useAuth();
  const [accounts, setAccounts] = useState<walletApi.P2pAccountRow[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotName, setScreenshotName] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Open deposit request being tracked in the background (after submit or
  // resumed on mount) so the async agent-SMS matcher can still confirm it.
  const [requestId, setRequestId] = useState<string | null>(null);
  // UI phase drives what the panel shows. "incorrect" keeps the entry form
  // visible so the user can re-check and re-enter their reference.
  const [phase, setPhase] = useState<
    "idle" | "incorrect" | "confirmed" | "cancelled"
  >("idle");
  const [attempts, setAttempts] = useState(0);

  const loadAccounts = () => {
    setLoadingAccounts(true);
    walletApi
      .listP2pAccounts()
      .then((res) => {
        const list = res.accounts ?? [];
        setAccounts(list);
        setSelectedDeviceId((prev) =>
          prev && list.some((a) => a.device_id === prev)
            ? prev
            : (list[0]?.device_id ?? null)
        );
      })
      .catch(() => setAccounts([]))
      .finally(() => setLoadingAccounts(false));
  };

  // Resume an existing open ("waiting") request so the user sees its status
  // and doesn't hit "you already have an open request".
  const loadOpenRequest = async () => {
    try {
      const hist = await walletApi.telebirrDepositHistory({ page: 1, limit: 10 });
      const open = (hist.items ?? []).find((i) => i.status === "waiting");
      if (!open) return;
      const s = await walletApi.telebirrDepositStatus(open.id);
      if (s.status === "confirmed") {
        setRequestId(s.request_id);
        setPhase("confirmed");
      } else if (s.status === "waiting") {
        // Track it only so the background poll can still confirm it and so the
        // next submit cancels it first — but keep showing the entry form.
        setRequestId(s.request_id);
      }
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    loadAccounts();
    void loadOpenRequest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDone = phase === "confirmed" || phase === "cancelled";

  // Keep matching the agent SMS in the background even while the user is being
  // prompted to re-check their reference, so a slightly-late SMS can still
  // confirm the deposit on its own ("waiting" keeps working behind the scenes).
  useEffect(() => {
    if (!requestId || isDone) return;
    const t = setInterval(async () => {
      try {
        const s = await walletApi.telebirrDepositStatus(requestId);
        if (s.status === "confirmed") {
          setPhase("confirmed");
          void refreshWallet();
        } else if (s.status === "expired" || s.status === "cancelled") {
          // This request is dead; drop it but keep the re-check form usable.
          setRequestId(null);
        }
      } catch {
        /* ignore transient poll errors */
      }
    }, 5000);
    return () => clearInterval(t);
  }, [requestId, isDone, refreshWallet]);

  const account = useMemo(
    () =>
      accounts.find((a) => a.device_id === selectedDeviceId) ??
      accounts[0] ??
      null,
    [accounts, selectedDeviceId]
  );

  const parsed = Number(amount || 0);
  // A live Telebirr transaction number is always a 10-character alphanumeric
  // code (e.g. "DGD2T2M9YQ"). Validate the format up-front so a mistyped /
  // wrong reference is caught immediately and we never open a deposit request
  // that can only ever sit in "Waiting".
  const normalizedRef = reference.trim().toUpperCase();
  const refFormatValid = /^[A-Z0-9]{10}$/.test(normalizedRef);
  const refInvalidFormat = normalizedRef.length > 0 && !refFormatValid;
  const MAX_ATTEMPTS = 3;
  const canSubmit =
    Number.isFinite(parsed) &&
    parsed >= 10 &&
    refFormatValid &&
    !busy &&
    phase !== "confirmed" &&
    phase !== "cancelled";

  const INCORRECT_REF_MESSAGE =
    "The 10-digit reference number you entered is incorrect. Please go back to your Telebirr message, check the reference number carefully, and enter it again.";

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1500);
    } catch {
      /* ignore */
    }
  };

  const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024; // 8MB

  const onPickScreenshot = (file: File | null | undefined) => {
    setErr("");
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErr("The screenshot must be an image file.");
      return;
    }
    if (file.size > MAX_SCREENSHOT_BYTES) {
      setErr("Screenshot is too large (max 8MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setScreenshot(typeof reader.result === "string" ? reader.result : null);
      setScreenshotName(file.name);
    };
    reader.onerror = () => setErr("Could not read the selected image.");
    reader.readAsDataURL(file);
  };

  const clearScreenshot = () => {
    setScreenshot(null);
    setScreenshotName("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  // Best-effort clear of any lingering "waiting" request (e.g. left open in
  // another tab) so a fresh initiate isn't blocked by open_request_exists.
  const cancelAllWaiting = async () => {
    try {
      const hist = await walletApi.telebirrDepositHistory({ page: 1, limit: 10 });
      const waiting = (hist.items ?? []).filter((i) => i.status === "waiting");
      for (const w of waiting) {
        try {
          await walletApi.telebirrDepositCancel(w.id);
        } catch {
          /* ignore */
        }
      }
    } catch {
      /* ignore */
    }
  };

  const submit = async () => {
    setErr("");
    if (!account) {
      setErr("No P2P agent is available right now. Please try again shortly.");
      return;
    }
    if (!Number.isFinite(parsed) || parsed < 10) {
      setErr("Enter an amount of at least 10 ETB.");
      return;
    }
    if (!refFormatValid) {
      setErr(INCORRECT_REF_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      // A previous incorrect attempt leaves its request "waiting" in the
      // background; cancel it before re-attempting with the corrected
      // reference so the single-open-request rule is respected.
      if (requestId) {
        try {
          await walletApi.telebirrDepositCancel(requestId);
        } catch {
          /* ignore */
        }
        setRequestId(null);
      }

      const doInitiate = () =>
        walletApi.telebirrDepositInitiate({
          amount: parsed,
          telebirr_reference: normalizedRef,
          ...(screenshot ? { screenshot_url: screenshot } : {}),
        });

      let out;
      try {
        out = await doInitiate();
      } catch (e) {
        const msg = (e as Error).message || "";
        if (/open .*request|already have an open/i.test(msg)) {
          await cancelAllWaiting();
          out = await doInitiate();
        } else {
          throw e;
        }
      }

      if (out.confirmed) {
        setRequestId(out.request_id);
        setPhase("confirmed");
        void refreshWallet();
        return;
      }

      // The reference did not match an agent payment on this attempt.
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);

      if (nextAttempts >= MAX_ATTEMPTS) {
        // Third strike — cancel the request automatically.
        try {
          await walletApi.telebirrDepositCancel(out.request_id);
        } catch {
          /* ignore */
        }
        setRequestId(null);
        setPhase("cancelled");
      } else {
        // Keep the request alive for the background matcher, but prompt the
        // user to re-check and re-enter the reference.
        setRequestId(out.request_id);
        setPhase("incorrect");
      }
    } catch (e) {
      const msg = (e as Error).message || "Failed to submit deposit.";
      setErr(/invalid reference/i.test(msg) ? INCORRECT_REF_MESSAGE : msg);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setRequestId(null);
    setPhase("idle");
    setAttempts(0);
    setAmount("");
    setReference("");
    clearScreenshot();
    setErr("");
  };

  const statusBadge = (s: walletApi.P2pAccountRow["status"]) => (
    <span
      className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
        s === "online"
          ? "bg-green-500/20 text-green-500"
          : s === "maintenance"
            ? "bg-yellow-500/20 text-yellow-500"
            : "bg-gray-500/20 text-gray-400"
      }`}
    >
      {s}
    </span>
  );

  return (
    <div className="space-y-3">
      <div className="p-4 rounded-lg space-y-3" style={{ background: "var(--mezzo-bg-secondary)" }}>
        <div className="flex items-center gap-2">
          <Landmark className="w-4 h-4 text-[var(--mezzo-accent-yellow)]" />
          <h3 className="font-semibold text-sm">P2P Transfer Deposit</h3>
          {(phase === "idle" || phase === "incorrect") && (
            <button
              type="button"
              onClick={loadAccounts}
              className="ml-auto inline-flex items-center gap-1 text-[11px] text-gray-400 hover:text-white"
              title="Refresh agents"
            >
              <RefreshCw className="w-3 h-3" />
              Refresh
            </button>
          )}
        </div>

        {/* ---- Result view once resolved, else the (re-)entry form ---- */}
        {phase === "confirmed" ? (
          <div className="space-y-3">
            <div className="px-3 py-2 rounded text-sm bg-green-500/15 border border-green-500/40 text-green-400 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Payment confirmed — your wallet has been credited.</span>
            </div>
            <Button
              onClick={reset}
              className="w-full h-9 text-black font-semibold"
              style={{ background: "var(--mezzo-accent-green)" }}
            >
              Make another deposit
            </Button>
          </div>
        ) : phase === "cancelled" ? (
          <div className="space-y-3">
            <div className="px-3 py-2 rounded text-sm bg-red-500/15 border border-red-500/40 text-red-400">
              <span className="font-semibold">Request cancelled.</span> The
              reference number could not be verified after {MAX_ATTEMPTS}{" "}
              attempts. Please double-check the 10-digit transaction number in
              your Telebirr SMS and start a new request.
            </div>
            <Button
              onClick={reset}
              className="w-full h-9 text-black font-semibold"
              style={{ background: "var(--mezzo-accent-green)" }}
            >
              Start over
            </Button>
          </div>
        ) : (
          /* ---- Entry form (idle or awaiting a corrected reference) ---- */
          <>
            {phase === "incorrect" && (
              <div className="px-3 py-2 rounded text-sm bg-red-500/15 border border-red-500/40 text-red-400">
                <span className="font-semibold">
                  The 10-digit reference number you entered is incorrect.
                </span>{" "}
                Please go back to your Telebirr message, check the reference
                number carefully, and enter it again.
                <span className="block mt-1 text-[11px] text-red-300/90">
                  Attempt {attempts} of {MAX_ATTEMPTS} — the request is
                  cancelled automatically after {MAX_ATTEMPTS} incorrect
                  attempts.
                </span>
              </div>
            )}

            <p className="text-xs text-gray-400">
              Send the amount to the Telebirr agent below, then paste the
              Telebirr reference from your payment SMS. Your wallet is credited
              automatically once it matches the agent&apos;s record.
            </p>

            {loadingAccounts ? (
              <div className="text-xs text-gray-400">Loading agent…</div>
            ) : accounts.length === 0 ? (
              <div className="px-3 py-2 rounded text-xs bg-yellow-500/15 border border-yellow-500/40 text-yellow-400">
                No P2P agent is currently available. Please try again shortly.
              </div>
            ) : (
              <>
                {accounts.length > 1 && (
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Choose an agent
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {accounts.map((a) => (
                        <button
                          key={a.device_id}
                          type="button"
                          onClick={() => setSelectedDeviceId(a.device_id)}
                          className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                            a.device_id === account?.device_id
                              ? "bg-[var(--mezzo-accent-green)] text-black"
                              : "text-gray-300 hover:text-white"
                          }`}
                          style={
                            a.device_id === account?.device_id
                              ? undefined
                              : { background: "var(--mezzo-bg-tertiary)" }
                          }
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {account && (
                  <div className="p-3 rounded space-y-1.5" style={{ background: "var(--mezzo-bg-tertiary)" }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Account Holder</span>
                      <span className="text-sm font-semibold">{account.label}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Phone Number</span>
                      <button
                        type="button"
                        onClick={() => void copy(account.phone)}
                        className="inline-flex items-center gap-1 text-sm font-mono text-[var(--mezzo-accent-yellow)] hover:underline"
                        title="Copy"
                      >
                        {account.phone}
                        <Copy className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">Status</span>
                      {statusBadge(account.status)}
                    </div>
                    {copied && <div className="text-[11px] text-green-400">Copied to clipboard</div>}
                  </div>
                )}
              </>
            )}

            <div>
              <label className="block text-xs text-gray-400 mb-1">Amount Transferred (ETB)</label>
              <Input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="h-9 bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
              />
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Telebirr Reference (from your payment SMS)
              </label>
              <Input
                type="text"
                inputMode="text"
                autoCapitalize="characters"
                maxLength={10}
                placeholder="e.g. DGD2T2M9YQ"
                value={reference}
                onChange={(e) =>
                  setReference(
                    e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)
                  )
                }
                className={`h-9 bg-[var(--mezzo-bg-tertiary)] text-white font-mono tracking-wide ${
                  refInvalidFormat ? "border-red-500" : "border-[var(--mezzo-border)]"
                }`}
              />
              {refInvalidFormat ? (
                <p className="text-[11px] text-red-400 mt-1">
                  Invalid Reference Number — the Telebirr transaction number is
                  exactly 10 letters/digits (e.g. DGD2T2M9YQ). Check your
                  Telebirr SMS and re-enter it.
                </p>
              ) : (
                <p className="text-[11px] text-gray-500 mt-1">
                  Copy the &quot;transaction number&quot; (10 characters) from the
                  Telebirr confirmation SMS you received after sending the money.
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">
                Payment Screenshot{" "}
                <span className="text-gray-500">(optional)</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => onPickScreenshot(e.target.files?.[0])}
              />
              {screenshot ? (
                <div
                  className="p-2 rounded flex items-center gap-3"
                  style={{ background: "var(--mezzo-bg-tertiary)" }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={screenshot}
                    alt="Payment screenshot"
                    className="w-12 h-12 rounded object-cover border border-[var(--mezzo-border)]"
                  />
                  <span className="text-xs text-gray-300 truncate flex-1">
                    {screenshotName || "Screenshot attached"}
                  </span>
                  <button
                    type="button"
                    onClick={clearScreenshot}
                    className="p-1 text-gray-400 hover:text-red-400"
                    title="Remove"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full h-9 rounded flex items-center justify-center gap-2 text-xs text-gray-300 border border-dashed border-[var(--mezzo-border)] hover:text-white hover:border-gray-500 transition-colors"
                  style={{ background: "var(--mezzo-bg-tertiary)" }}
                >
                  <Upload className="w-4 h-4" />
                  Upload Telebirr payment screenshot
                </button>
              )}
              <p className="text-[11px] text-gray-500 mt-1">
                Optional: attach the Telebirr confirmation screenshot as extra
                proof of payment (max 8MB). The reference above is enough to
                confirm automatically.
              </p>
            </div>

            {err && <div className="text-xs text-red-400">{err}</div>}

            <Button
              onClick={() => void submit()}
              disabled={!canSubmit || accounts.length === 0}
              className="w-full h-9 text-black font-semibold disabled:opacity-50"
              style={{ background: "var(--mezzo-accent-green)" }}
            >
              {busy
                ? "Submitting…"
                : phase === "incorrect"
                  ? "Re-check & Submit"
                  : "I've Sent — Submit Deposit"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function HistoryList() {
  const [items, setItems] = useState<Array<{ id: string; amount: string; status: string; created_at: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    walletApi
      .telebirrDepositHistory({ page: 1, limit: 20 })
      .then((res) => setItems((res.items ?? []) as Array<{ id: string; amount: string; status: string; created_at: string }>))
      .catch((err) => setError((err as Error).message || "Failed to load history"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-sm text-gray-400">Loading history...</div>;
  if (error) return <div className="text-sm text-red-400">{error}</div>;
  if (!items.length) return <div className="text-sm text-gray-400">No deposits yet.</div>;

  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={i.id} className="p-3 rounded text-xs" style={{ background: "var(--mezzo-bg-secondary)" }}>
          <div className="flex justify-between">
            <span className="font-mono">{i.id.slice(0, 10)}</span>
            <span className="capitalize">{i.status}</span>
          </div>
          <div className="text-gray-400 mt-1">
            {i.amount} ETB - {new Date(i.created_at).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
}
