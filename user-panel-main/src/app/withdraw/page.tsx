"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Betslip } from "@/components/Betslip";
import {
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  AlertCircle,
  RefreshCw,
  Lock,
  Building2,
  Copy,
  Landmark,
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

export default function WithdrawPage() {
  const { wallet, refreshWallet } = useAuth();
  const [activeTab, setActiveTab] = useState("request");
  const [historyCount, setHistoryCount] = useState(0);

  const balanceLine = wallet?.summary?.[0];
  const balance = Number(balanceLine?.balance ?? 0);
  // Deposit-wagering rule: deposited funds must be wagered before they can
  // be withdrawn — only the withdrawable portion may leave the wallet.
  const withdrawable = Number(balanceLine?.withdrawable_balance ?? balanceLine?.balance ?? 0);
  const wageringRemaining = Number(balanceLine?.wagering_remaining ?? 0);

  useEffect(() => {
    walletApi
      .telebirrWithdrawalHistory({ page: 1, limit: 5 })
      .then((res) => setHistoryCount(res.total ?? 0))
      .catch(() => setHistoryCount(0));
  }, []);

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <div className="flex-1 p-4 sm:p-6" style={{ background: "var(--mezzo-bg-primary)" }}>
        <div className="max-w-3xl mx-auto">
          <OperationSwitcher />
          <div className="flex items-center gap-2 mb-3">
            <Wallet className="w-5 h-5 text-[var(--mezzo-accent-yellow)]" />
            <h1 className="text-xl font-bold">Withdraw Funds</h1>
            <span className="ml-auto text-xs px-2 py-1 rounded" style={{ background: "var(--mezzo-bg-secondary)" }}>
              Balance: <span className="text-[var(--mezzo-accent-green)] font-semibold">{balance.toFixed(2)} ETB</span>
            </span>
            <span className="text-xs px-2 py-1 rounded" style={{ background: "var(--mezzo-bg-secondary)" }}>
              Withdrawable: <span className="text-[var(--mezzo-accent-yellow)] font-semibold">{withdrawable.toFixed(2)} ETB</span>
            </span>
          </div>
          {wageringRemaining > 0 && (
            <div className="px-3 py-2 rounded mb-3 text-xs bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>
                Deposited funds must be wagered before they can be withdrawn.
                You still need to wager{" "}
                <strong>{wageringRemaining.toFixed(2)} ETB</strong> — until
                then only winnings ({withdrawable.toFixed(2)} ETB) are
                withdrawable.
              </span>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-4 mb-4 h-9" style={{ background: "var(--mezzo-bg-secondary)" }}>
              <TabsTrigger value="request" className="text-xs data-[state=active]:bg-[var(--mezzo-accent-green)] data-[state=active]:text-black">
                Online Payment
              </TabsTrigger>
              <TabsTrigger value="p2p" className="text-xs data-[state=active]:bg-[var(--mezzo-accent-green)] data-[state=active]:text-black">
                P2P
              </TabsTrigger>
              <TabsTrigger value="branch" className="text-xs data-[state=active]:bg-[var(--mezzo-accent-green)] data-[state=active]:text-black">
                Branch
              </TabsTrigger>
              <TabsTrigger value="history" className="text-xs data-[state=active]:bg-[var(--mezzo-accent-green)] data-[state=active]:text-black">
                History ({historyCount})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="request" className="space-y-3">
              <OnlinePaymentPanel
                channel="withdrawal"
                balance={withdrawable}
                refreshWallet={refreshWallet}
              />
            </TabsContent>

            <TabsContent value="p2p">
              {/* Panels cap requests at the withdrawable portion so the
                  deposit-wagering rule is reflected client-side too. */}
              <P2PWithdrawPanel balance={withdrawable} refreshWallet={refreshWallet} />
            </TabsContent>

            <TabsContent value="branch">
              <BranchWithdrawalPanel
                balance={withdrawable}
                refreshWallet={refreshWallet}
              />
            </TabsContent>

            <TabsContent value="history">
              <WithdrawalHistory refreshWallet={refreshWallet} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Betslip />
    </div>
  );
}

function P2PWithdrawPanel({
  balance,
  refreshWallet,
}: {
  balance: number;
  refreshWallet: () => Promise<void>;
}) {
  const { user } = useAuth();
  const [phone, setPhone] = useState(user?.phone ?? "");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  useEffect(() => {
    setPhone(user?.phone ?? "");
  }, [user?.phone]);

  const parsed = Number(amount || 0);
  const canSubmit =
    Number.isFinite(parsed) &&
    parsed >= 10 &&
    parsed <= balance &&
    !!phone.trim() &&
    !busy;

  const submit = async () => {
    setErr("");
    setOkMsg("");
    if (!canSubmit) {
      setErr(
        parsed > balance
          ? "Withdrawal exceeds available balance."
          : "Enter an amount of at least 10 ETB."
      );
      return;
    }
    setBusy(true);
    try {
      const out = await walletApi.telebirrWithdrawalInitiate({
        amount: String(parsed),
        telebirr_number: phone.trim(),
      });
      setOkMsg(
        `Withdrawal submitted (${out.request_id}). ` +
          (out.status === "processing"
            ? "An agent is sending your Telebirr payout now."
            : "Waiting for an available agent to send your payout.")
      );
      setAmount("");
      await refreshWallet();
    } catch (e) {
      setErr((e as Error).message || "Failed to submit withdrawal request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="p-4 rounded-lg space-y-3" style={{ background: "var(--mezzo-bg-secondary)" }}>
        <div className="flex items-center gap-2">
          <Landmark className="w-4 h-4 text-[var(--mezzo-accent-yellow)]" />
          <h3 className="font-semibold text-sm">P2P Telebirr Withdrawal</h3>
        </div>
        <p className="text-xs text-gray-400">
          Enter the amount and we send it to your profile Telebirr number
          automatically from an agent wallet via USSD.
        </p>

        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Your Phone Number (from your profile)
          </label>
          <Input
            value={phone}
            readOnly
            className="h-9 bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white opacity-80"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-400 mb-1">Amount (ETB)</label>
          <Input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-9 bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
          />
        </div>

        <div className="text-[11px] text-gray-500 flex items-center gap-1">
          <Lock className="w-3 h-3" />
          Withdrawal requires sufficient available balance.
        </div>
        {err && <div className="text-xs text-red-400">{err}</div>}
        {okMsg && (
          <div className="px-3 py-2 rounded text-xs bg-green-500/15 border border-green-500/40 text-green-400">
            {okMsg}
          </div>
        )}

        <Button
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="w-full h-9 text-black font-semibold disabled:opacity-50"
          style={{ background: "var(--mezzo-accent-green)" }}
        >
          {busy ? "Submitting…" : "Submit Request"}
        </Button>
      </div>
    </div>
  );
}

function BranchWithdrawalPanel({
  balance,
  refreshWallet,
}: {
  balance: number;
  refreshWallet: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [items, setItems] = useState<walletApi.BranchWithdrawalRow[]>([]);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const parsed = Number(amount || 0);

  const load = async () => {
    try {
      const out = await walletApi.listBranchWithdrawals({ limit: 20 });
      setItems(out.items ?? []);
    } catch {
      setItems([]);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const canSubmit =
    Number.isFinite(parsed) && parsed >= 10 && parsed <= balance && !busy;

  const submit = async () => {
    setErr("");
    if (!canSubmit) {
      setErr("Enter a valid amount that doesn't exceed your balance.");
      return;
    }
    setBusy(true);
    try {
      await walletApi.createBranchWithdrawal({ amount: parsed });
      setAmount("");
      await Promise.all([load(), refreshWallet()]);
    } catch (e) {
      setErr((e as Error).message || "Failed to create branch withdrawal.");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (id: string) => {
    setErr("");
    try {
      await walletApi.cancelBranchWithdrawal(id);
      await Promise.all([load(), refreshWallet()]);
    } catch (e) {
      setErr((e as Error).message || "Failed to cancel code.");
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((c) => (c === code ? null : c)), 1500);
    } catch {
      // ignore clipboard failures (older browsers / non-secure context)
    }
  };

  return (
    <div className="space-y-3">
      <div
        className="p-4 rounded-lg space-y-3"
        style={{ background: "var(--mezzo-bg-secondary)" }}
      >
        <div className="flex items-center gap-2">
          <Building2 className="w-4 h-4 text-[var(--mezzo-accent-yellow)]" />
          <h3 className="font-semibold text-sm">Branch (Cash) Withdrawal</h3>
        </div>
        <p className="text-xs text-gray-400">
          Generate a single-use code and bring it to any branch shop. The
          cashier will hand you cash and the balance is reserved until then.
        </p>
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Amount (ETB)
          </label>
          <Input
            type="number"
            placeholder="0.00"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-9 bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
          />
        </div>
        {err && <div className="text-xs text-red-400">{err}</div>}
        <Button
          onClick={() => void submit()}
          disabled={!canSubmit}
          className="w-full h-9 text-black font-semibold disabled:opacity-50"
          style={{ background: "var(--mezzo-accent-green)" }}
        >
          {busy ? "Generating…" : "Generate Code"}
        </Button>
      </div>

      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-gray-300 uppercase tracking-wider">
          Active Codes
        </h4>
        {items.length === 0 ? (
          <div className="text-sm text-gray-500">No codes yet.</div>
        ) : (
          items.map((it) => (
            <div
              key={it.id}
              className="p-3 rounded text-xs space-y-1"
              style={{ background: "var(--mezzo-bg-secondary)" }}
            >
              <div className="flex items-center justify-between">
                <div className="font-mono text-base text-[var(--mezzo-accent-yellow)] tracking-widest">
                  {it.code}
                </div>
                <button
                  type="button"
                  onClick={() => void copy(it.code)}
                  className="text-gray-300 hover:text-white inline-flex items-center gap-1 text-[11px]"
                  title="Copy code"
                >
                  <Copy className="w-3 h-3" />
                  {copiedCode === it.code ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>
                  {Number(it.amount).toFixed(2)} {it.currency || "ETB"}
                </span>
                <span className="capitalize">{it.status}</span>
              </div>
              <div className="text-gray-500">
                Expires {new Date(it.expires_at).toLocaleString()}
              </div>
              {it.status === "pending" && (
                <Button
                  variant="outline"
                  className="h-7 mt-1 border-gray-700 bg-transparent text-white hover:bg-gray-800 text-xs"
                  onClick={() => void cancel(it.id)}
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Cancel
                </Button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function WithdrawalHistory({ refreshWallet }: { refreshWallet: () => Promise<void> }) {
  const [items, setItems] = useState<
    Array<{
      id: string;
      amount: string;
      telebirr_number: string;
      account_name: string;
      status: string;
      created_at: string;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await walletApi.telebirrWithdrawalHistory({ page: 1, limit: 20 });
      setItems(
        (res.items ?? []) as Array<{
          id: string;
          amount: string;
          telebirr_number: string;
          account_name: string;
          status: string;
          created_at: string;
        }>
      );
    } catch (err) {
      setError((err as Error).message || "Failed to load withdrawal history.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  if (loading) return <div className="text-sm text-gray-400">Loading history...</div>;
  if (error) return <div className="text-sm text-red-400">{error}</div>;
  if (!items.length) return <div className="text-sm text-gray-400">No withdrawals yet.</div>;

  return (
    <div className="space-y-2">
      {items.map((i) => (
        <div key={i.id} className="p-3 rounded text-xs" style={{ background: "var(--mezzo-bg-secondary)" }}>
          <div className="flex justify-between">
            <span className="font-mono">{i.id.slice(0, 10)}</span>
            <span className="capitalize">{i.status}</span>
          </div>
          <div className="text-gray-400 mt-1">
            {i.amount} ETB - {i.telebirr_number} ({i.account_name})
          </div>
          {i.status === "pending" && (
            <Button
              variant="outline"
              className="h-7 mt-2 border-gray-700 bg-transparent text-white hover:bg-gray-800 text-xs"
              onClick={async () => {
                await walletApi.telebirrWithdrawalCancel(i.id);
                await load();
                await refreshWallet();
              }}
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Cancel
            </Button>
          )}
        </div>
      ))}
    </div>
  );
}
