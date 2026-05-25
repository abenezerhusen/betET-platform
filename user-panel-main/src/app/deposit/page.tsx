"use client";

import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Betslip } from "@/components/Betslip";
import {
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/context/AuthContext";
import { bonusesApi, walletApi } from "@/lib/api";

const depositSchema = z.object({
  // Zod v4 dropped `invalid_type_error`; use `message` instead.
  amount: z
    .number({ message: "Amount is required" })
    .positive("Amount must be greater than zero")
    .min(10, "Minimum deposit is 10 ETB")
    .max(1_000_000, "Maximum deposit is 1,000,000 ETB"),
});

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
  const { user, wallet, refreshWallet } = useAuth();
  const [activeTab, setActiveTab] = useState("online");
  const [amount, setAmount] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [processing, setProcessing] = useState(false);
  const [validationError, setValidationError] = useState("");

  const [requestId, setRequestId] = useState<string | null>(null);
  const [requestStatus, setRequestStatus] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [telebirrNumber, setTelebirrNumber] = useState("");
  const [referenceCode, setReferenceCode] = useState("");
  const [historyCount, setHistoryCount] = useState(0);
  // Section 15 spec: surface the list of Telebirr agent phone numbers the
  // customer can manually send to (sourced from `GET /api/p2p/accounts`)
  // so the deposit screen doubles as a directory before the user hits
  // "Initiate Deposit". The Telebirr-initiate flow still works as before.
  const [agentAccounts, setAgentAccounts] = useState<
    walletApi.P2pAccountRow[]
  >([]);

  const balanceLine = wallet?.summary?.[0];
  const balance = Number(balanceLine?.balance ?? 0);
  const bonusBalance = Number(balanceLine?.bonus_balance ?? 0);
  const parsedAmount = useMemo(() => Number(amount || 0), [amount]);

  useEffect(() => {
    bonusesApi
      .listPaymentMethods({ channel: "deposit" })
      .catch(() => undefined);
    walletApi
      .telebirrDepositHistory({ page: 1, limit: 5 })
      .then((res) => setHistoryCount(res.total ?? 0))
      .catch(() => setHistoryCount(0));
    walletApi
      .listP2pAccounts()
      .then((res) => setAgentAccounts(res.accounts ?? []))
      .catch(() => setAgentAccounts([]));
  }, []);

  useEffect(() => {
    if (!requestId) return;
    const t = setInterval(() => {
      walletApi
        .telebirrDepositStatus(requestId)
        .then((s) => {
          setRequestStatus(s.status);
          if (s.status === "confirmed") {
            void refreshWallet();
          }
        })
        .catch(() => undefined);
    }, 5000);
    return () => clearInterval(t);
  }, [requestId, refreshWallet]);

  const confirmOnlineDeposit = async () => {
    const parsed = depositSchema.safeParse({ amount: parsedAmount });
    if (!parsed.success) {
      setValidationError(parsed.error.issues[0]?.message ?? "Invalid amount");
      return;
    }
    setValidationError("");
    setProcessing(true);
    setErrorMsg("");
    setSuccessMsg("");
    try {
      const out = await walletApi.telebirrDepositInitiate({ amount: parsed.data.amount });
      setRequestId(out.request_id);
      setRequestStatus(out.status);
      setExpiresAt(out.expires_at ?? null);
      setTelebirrNumber(out.payment_url ?? "");
      setReferenceCode(out.request_id);
      setSuccessMsg(`Deposit request submitted for ${out.amount} ETB.`);
      setConfirmOpen(false);
      setAmount("");
    } catch (err) {
      setErrorMsg((err as Error).message || "Deposit initiation failed.");
    } finally {
      setProcessing(false);
    }
  };

  const canSubmit = parsedAmount > 0;

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

          {successMsg && (
            <div className="px-3 py-2 rounded mb-3 text-sm bg-green-500/15 border border-green-500/40 text-green-400 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
          {errorMsg && (
            <div className="px-3 py-2 rounded mb-3 text-sm bg-red-500/15 border border-red-500/40 text-red-400 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4 h-9" style={{ background: "var(--mezzo-bg-secondary)" }}>
              <TabsTrigger value="online" className="text-xs data-[state=active]:bg-[var(--mezzo-accent-green)] data-[state=active]:text-black">
                Telebirr
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs data-[state=active]:bg-[var(--mezzo-accent-green)] data-[state=active]:text-black">
                History ({historyCount})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="online" className="space-y-3">
              {agentAccounts.length > 0 && (
                <div
                  className="p-4 rounded-lg space-y-2"
                  style={{ background: "var(--mezzo-bg-secondary)" }}
                >
                  <h3 className="font-semibold text-sm">
                    Send Telebirr to one of our agents
                  </h3>
                  <p className="text-xs text-gray-400">
                    After you send, click "Initiate Deposit" so the system
                    can match your transfer to your account.
                  </p>
                  <ul className="space-y-2 mt-1">
                    {agentAccounts.map((a) => (
                      <li
                        key={`${a.device_id}:${a.account_id ?? a.phone}`}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded"
                        style={{ background: "var(--mezzo-bg-tertiary)" }}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-semibold truncate">
                            {a.label}
                          </div>
                          <div className="text-xs text-gray-400">
                            {a.phone}
                          </div>
                        </div>
                        <div className="text-right">
                          <span
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded ${
                              a.status === "online"
                                ? "bg-green-500/20 text-green-500"
                                : a.status === "maintenance"
                                  ? "bg-yellow-500/20 text-yellow-500"
                                  : "bg-gray-500/20 text-gray-400"
                            }`}
                          >
                            {a.status}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              if (typeof navigator !== "undefined") {
                                void navigator.clipboard
                                  ?.writeText(a.phone)
                                  .catch(() => undefined);
                              }
                            }}
                            className="block mt-1 text-[10px] text-[var(--mezzo-accent-yellow)] hover:underline"
                          >
                            Copy number
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="p-4 rounded-lg space-y-3" style={{ background: "var(--mezzo-bg-secondary)" }}>
                <h3 className="font-semibold text-sm">Telebirr Deposit</h3>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Amount (ETB)</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="h-9 bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
                  />
                  {validationError && (
                    <p className="text-xs text-red-400 mt-1">{validationError}</p>
                  )}
                </div>
                <div className="text-xs text-gray-400">Account: {user?.phone ?? user?.email ?? "N/A"}</div>
                <Button
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canSubmit}
                  className="w-full h-9 text-black font-semibold disabled:opacity-50"
                  style={{ background: "var(--mezzo-accent-green)" }}
                >
                  Initiate Deposit
                </Button>
              </div>

              {requestId && (
                <div className="p-4 rounded-lg space-y-2" style={{ background: "var(--mezzo-bg-secondary)" }}>
                  <div className="flex items-center gap-2 text-sm">
                    <Clock className="w-4 h-4 text-[var(--mezzo-accent-yellow)]" />
                    Request: {requestId}
                  </div>
                  <div className="text-xs text-gray-300">Status: {requestStatus || "pending"}</div>
                  {expiresAt && <div className="text-xs text-gray-400">Expires: {new Date(expiresAt).toLocaleString()}</div>}
                  {telebirrNumber && <div className="text-xs text-gray-400">Telebirr: {telebirrNumber}</div>}
                  {referenceCode && <div className="text-xs text-gray-400">Reference: {referenceCode}</div>}
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="h-8 border-gray-700 bg-transparent text-white hover:bg-gray-800 text-xs"
                      onClick={async () => {
                        if (!requestId) return;
                        const s = await walletApi.telebirrDepositStatus(requestId);
                        setRequestStatus(s.status);
                        if (s.status === "confirmed") void refreshWallet();
                      }}
                    >
                      <RefreshCw className="w-3.5 h-3.5 mr-1" />
                      Refresh status
                    </Button>
                    <Button
                      variant="outline"
                      className="h-8 border-gray-700 bg-transparent text-white hover:bg-gray-800 text-xs"
                      onClick={async () => {
                        if (!requestId) return;
                        await walletApi.telebirrDepositCancel(requestId);
                        setRequestStatus("cancelled");
                      }}
                    >
                      Cancel request
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="history">
              <HistoryList />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="bg-black border-gray-800 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirm Telebirr deposit</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2 text-sm">
            <div className="p-3 rounded space-y-1" style={{ background: "var(--mezzo-bg-tertiary)" }}>
              <div className="flex justify-between">
                <span className="text-gray-400">Amount</span>
                <span className="font-semibold text-[var(--mezzo-accent-green)]">{parsedAmount.toFixed(2)} ETB</span>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                className="flex-1 h-9 border-gray-700 bg-transparent text-white hover:bg-gray-800"
              >
                Cancel
              </Button>
              <Button
                onClick={() => void confirmOnlineDeposit()}
                disabled={processing}
                className="flex-1 h-9 text-black font-semibold"
                style={{ background: "var(--mezzo-accent-green)" }}
              >
                {processing ? "Submitting..." : "Confirm"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Betslip />
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
