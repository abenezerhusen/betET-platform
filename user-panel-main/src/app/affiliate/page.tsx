"use client";

import { useEffect, useState } from "react";
import {
  Users,
  TrendingUp,
  Wallet,
  Banknote,
  Smartphone,
  Save,
  CheckCircle2,
  AlertCircle,
  Clock,
  Copy,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import {
  getAffiliateSummary,
  updateAffiliatePayoutAccount,
  listAffiliateReferrals,
  listAffiliateWithdrawals,
  requestAffiliateWithdrawal,
  type AffiliateSummary,
  type AffiliateReferralRow,
  type AffiliateWithdrawalRow,
} from "@/lib/api/affiliate";
import { getPublicGeneral, getFooterLinks } from "@/lib/api/publicConfig";

// Fallback contact used only until the admin-configured value loads.
const DEFAULT_TELEGRAM = "https://t.me/1birr_support";

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div
      className="p-4 rounded-lg"
      style={{ background: "var(--mezzo-bg-secondary)" }}
    >
      <div className="flex items-center gap-2 text-gray-400 text-xs mb-2">
        <Icon className="w-4 h-4" />
        {label}
      </div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-yellow-500/15 text-yellow-400 border-yellow-500/40",
  approved: "bg-blue-500/15 text-blue-400 border-blue-500/40",
  paid: "bg-green-500/15 text-green-400 border-green-500/40",
  rejected: "bg-red-500/15 text-red-400 border-red-500/40",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${
        STATUS_STYLES[status] ?? "bg-gray-500/15 text-gray-300 border-gray-500/40"
      }`}
    >
      {status}
    </span>
  );
}

export default function AffiliatePage() {
  const { isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<AffiliateSummary | null>(null);
  const [referrals, setReferrals] = useState<AffiliateReferralRow[]>([]);
  const [withdrawals, setWithdrawals] = useState<AffiliateWithdrawalRow[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  // Admin-configurable Telegram support link (Settings → General → Footer →
  // "Telegram Support", falling back to Social → Telegram). Changeable anytime.
  const [supportTelegram, setSupportTelegram] = useState<string>(DEFAULT_TELEGRAM);

  // Payout account form
  const [bankName, setBankName] = useState("");
  const [bankAccountName, setBankAccountName] = useState("");
  const [bankAccountNumber, setBankAccountNumber] = useState("");
  const [telebirrNumber, setTelebirrNumber] = useState("");
  const [savingAccount, setSavingAccount] = useState(false);

  // Withdrawal form
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"bank" | "telebirr">("telebirr");
  const [requesting, setRequesting] = useState(false);

  const available = summary?.balance?.available ?? 0;

  const reload = async () => {
    setLoading(true);
    setError("");
    try {
      const s = await getAffiliateSummary();
      setSummary(s);
      if (s.is_affiliate) {
        if (s.payout_account) {
          setBankName(s.payout_account.bank_name ?? "");
          setBankAccountName(s.payout_account.bank_account_name ?? "");
          setBankAccountNumber(s.payout_account.bank_account_number ?? "");
          setTelebirrNumber(s.payout_account.telebirr_number ?? "");
        }
        const [refs, wds] = await Promise.all([
          listAffiliateReferrals({ limit: 100 }),
          listAffiliateWithdrawals({ limit: 100 }),
        ]);
        setReferrals(refs.items ?? []);
        setWithdrawals(wds.items ?? []);
      }
    } catch (err) {
      setError((err as Error)?.message || "Failed to load affiliate data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Load the admin-configured Telegram support contact so the "not an
  // affiliate yet" message points at a link the admin can change anytime.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getFooterLinks().catch(() => null),
      getPublicGeneral().catch(() => null),
    ]).then(([links, general]) => {
      if (cancelled) return;
      const href = links?.telegram_link || general?.social?.telegram;
      if (href) setSupportTelegram(href);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const telegramHandle = supportTelegram.includes("t.me/")
    ? `@${supportTelegram.split("t.me/")[1]?.replace(/\/$/, "")}`
    : supportTelegram;

  const saveAccount = async () => {
    setSavingAccount(true);
    setError("");
    setSuccess("");
    try {
      await updateAffiliatePayoutAccount({
        bank_name: bankName,
        bank_account_name: bankAccountName,
        bank_account_number: bankAccountNumber,
        telebirr_number: telebirrNumber,
      });
      setSuccess("Payout account saved.");
      await reload();
    } catch (err) {
      setError((err as Error)?.message || "Failed to save payout account");
    } finally {
      setSavingAccount(false);
    }
  };

  const submitWithdrawal = async () => {
    setError("");
    setSuccess("");
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Enter a valid withdrawal amount.");
      return;
    }
    if (amt > available) {
      setError("Amount exceeds your available commission balance.");
      return;
    }
    setRequesting(true);
    try {
      await requestAffiliateWithdrawal({ amount: amt, method });
      setSuccess("Withdrawal request submitted. An admin will review it shortly.");
      setAmount("");
      await reload();
    } catch (err) {
      setError((err as Error)?.message || "Failed to submit withdrawal request");
    } finally {
      setRequesting(false);
    }
  };

  const copyCode = async () => {
    const code = summary?.affiliate?.code;
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setSuccess("Referral code copied.");
    } catch {
      /* ignore */
    }
  };

  const currency = summary?.affiliate?.currency ?? "ETB";
  const fmt = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${currency}`;

  const destinationText = (w: AffiliateWithdrawalRow) => {
    const d = w.destination ?? {};
    if (w.method === "telebirr") return `Telebirr ${d.telebirr_number ?? ""}`.trim();
    return `${d.bank_name ?? ""} ${d.bank_account_number ?? ""}`.trim() || "Bank";
  };

  const notAffiliate = summary && !summary.is_affiliate;

  return (
    <div className="flex min-h-[calc(100vh-180px)]">
      <div className="flex-1 p-4 sm:p-8" style={{ background: "var(--mezzo-bg-primary)" }}>
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <Users className="w-6 h-6" />
          Affiliate Dashboard
        </h1>

        {loading && <p className="text-sm text-gray-400 mb-4">Loading…</p>}

        {error && (
          <div className="flex items-center gap-2 px-4 py-2 mb-4 rounded bg-red-500/15 border border-red-500/40 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
        {success && (
          <div className="flex items-center gap-2 px-4 py-2 mb-4 rounded bg-green-500/15 border border-green-500/40 text-green-400 text-sm">
            <CheckCircle2 className="w-4 h-4" />
            {success}
          </div>
        )}

        {notAffiliate && !loading && (
          <div
            className="p-6 rounded-lg max-w-xl text-gray-300"
            style={{ background: "var(--mezzo-bg-secondary)" }}
          >
            You are not registered as an affiliate yet. To join the affiliate
            program and start earning commission on the players you refer,
            contact us on Telegram:{" "}
            <a
              href={supportTelegram}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-green-400 hover:text-green-300 underline underline-offset-2"
            >
              {telegramHandle}
            </a>
            .
          </div>
        )}

        {summary?.is_affiliate && (
          <div className="max-w-4xl space-y-6">
            {/* Affiliate identity */}
            <div
              className="p-6 rounded-lg flex flex-wrap items-center justify-between gap-4"
              style={{ background: "var(--mezzo-bg-secondary)" }}
            >
              <div>
                <div className="text-lg font-bold text-white">
                  {summary.affiliate?.name}
                </div>
                <div className="text-xs text-gray-400 mt-1 capitalize">
                  {summary.affiliate?.plan?.replace("_", " ")} • {summary.affiliate?.commission_pct}% •{" "}
                  <span className="capitalize">{summary.affiliate?.status}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-400 mb-1">Referral code</div>
                <button
                  onClick={copyCode}
                  className="flex items-center gap-2 text-white font-mono font-bold text-lg hover:text-green-400"
                >
                  {summary.affiliate?.code}
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                icon={Users}
                label="Total Referrals"
                value={String(summary.stats?.total_referrals ?? 0)}
                sub={`${summary.stats?.active_users ?? 0} active`}
              />
              <StatCard
                icon={TrendingUp}
                label="Player Revenue"
                value={fmt(summary.stats?.revenue_generated ?? 0)}
              />
              <StatCard
                icon={Wallet}
                label="Commission Balance"
                value={fmt(summary.balance?.earnings_total ?? 0)}
                sub={`${fmt(summary.balance?.reserved ?? 0)} reserved`}
              />
              <StatCard
                icon={CheckCircle2}
                label="Total Paid Out"
                value={fmt(summary.balance?.total_paid ?? 0)}
              />
            </div>

            {/* Payout account + Withdrawal request */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Payout account */}
              <div
                className="p-6 rounded-lg space-y-4"
                style={{ background: "var(--mezzo-bg-secondary)" }}
              >
                <h3 className="font-bold flex items-center gap-2">
                  <Banknote className="w-4 h-4" />
                  Payout Accounts
                </h3>
                <p className="text-xs text-gray-500 -mt-2">
                  Register where you want your commission paid. Admins transfer the
                  money manually to these accounts after approving a withdrawal.
                </p>

                <div className="space-y-3">
                  <div className="text-xs font-semibold text-gray-400 flex items-center gap-2">
                    <Smartphone className="w-3.5 h-3.5" /> Telebirr
                  </div>
                  <Input
                    value={telebirrNumber}
                    onChange={(e) => setTelebirrNumber(e.target.value)}
                    placeholder="Telebirr number"
                    className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
                  />
                </div>

                <div className="space-y-3">
                  <div className="text-xs font-semibold text-gray-400 flex items-center gap-2">
                    <Banknote className="w-3.5 h-3.5" /> Bank Account
                  </div>
                  <Input
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="Bank name"
                    className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
                  />
                  <Input
                    value={bankAccountName}
                    onChange={(e) => setBankAccountName(e.target.value)}
                    placeholder="Account holder name"
                    className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
                  />
                  <Input
                    value={bankAccountNumber}
                    onChange={(e) => setBankAccountNumber(e.target.value)}
                    placeholder="Account number"
                    className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
                  />
                </div>

                <Button
                  onClick={() => void saveAccount()}
                  disabled={savingAccount}
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {savingAccount ? "Saving…" : "Save Payout Accounts"}
                </Button>
              </div>

              {/* Withdrawal request */}
              <div
                className="p-6 rounded-lg space-y-4"
                style={{ background: "var(--mezzo-bg-secondary)" }}
              >
                <h3 className="font-bold flex items-center gap-2">
                  <Wallet className="w-4 h-4" />
                  Request Withdrawal
                </h3>
                <div className="text-sm text-gray-300">
                  Available to withdraw:{" "}
                  <span className="font-bold text-green-400">{fmt(available)}</span>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Amount</label>
                  <Input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                    className="bg-[var(--mezzo-bg-tertiary)] border-[var(--mezzo-border)] text-white"
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">Payout method</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setMethod("telebirr")}
                      className={`flex-1 px-3 py-2 rounded-md text-sm border ${
                        method === "telebirr"
                          ? "bg-green-600 border-green-600 text-white"
                          : "border-[var(--mezzo-border)] text-gray-300"
                      }`}
                    >
                      Telebirr
                    </button>
                    <button
                      type="button"
                      onClick={() => setMethod("bank")}
                      className={`flex-1 px-3 py-2 rounded-md text-sm border ${
                        method === "bank"
                          ? "bg-green-600 border-green-600 text-white"
                          : "border-[var(--mezzo-border)] text-gray-300"
                      }`}
                    >
                      Bank
                    </button>
                  </div>
                </div>

                <Button
                  onClick={() => void submitWithdrawal()}
                  disabled={requesting || available <= 0}
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  {requesting ? "Submitting…" : "Request Withdrawal"}
                </Button>
                <p className="text-xs text-gray-500">
                  Requests are reviewed and paid manually by an admin. You&apos;ll see
                  the status update below.
                </p>
              </div>
            </div>

            {/* Withdrawal history */}
            <div
              className="rounded-lg overflow-hidden"
              style={{ background: "var(--mezzo-bg-secondary)" }}
            >
              <div className="px-6 py-4 border-b border-[var(--mezzo-border)] flex items-center gap-2 font-bold">
                <Clock className="w-4 h-4" />
                Withdrawal History
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 text-xs">
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Amount</th>
                      <th className="px-6 py-3">Method</th>
                      <th className="px-6 py-3">Destination</th>
                      <th className="px-6 py-3">Status</th>
                      <th className="px-6 py-3">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {withdrawals.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-6 py-6 text-center text-gray-500">
                          No withdrawal requests yet.
                        </td>
                      </tr>
                    )}
                    {withdrawals.map((w) => (
                      <tr key={w.id} className="border-t border-[var(--mezzo-border)] text-gray-200">
                        <td className="px-6 py-3">
                          {w.requested_at ? new Date(w.requested_at).toLocaleString() : "—"}
                        </td>
                        <td className="px-6 py-3 font-semibold">{fmt(w.amount)}</td>
                        <td className="px-6 py-3 capitalize">{w.method}</td>
                        <td className="px-6 py-3 text-xs text-gray-400">{destinationText(w)}</td>
                        <td className="px-6 py-3">
                          <StatusPill status={w.status} />
                          {w.status === "rejected" && w.admin_note && (
                            <div className="text-xs text-red-400 mt-1">{w.admin_note}</div>
                          )}
                        </td>
                        <td className="px-6 py-3 text-xs text-gray-400">{w.reference || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Referrals */}
            <div
              className="rounded-lg overflow-hidden"
              style={{ background: "var(--mezzo-bg-secondary)" }}
            >
              <div className="px-6 py-4 border-b border-[var(--mezzo-border)] flex items-center gap-2 font-bold">
                <Users className="w-4 h-4" />
                My Referrals
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-400 text-xs">
                      <th className="px-6 py-3">Referred User</th>
                      <th className="px-6 py-3">Joined</th>
                      <th className="px-6 py-3">Bonus</th>
                      <th className="px-6 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {referrals.length === 0 && (
                      <tr>
                        <td colSpan={4} className="px-6 py-6 text-center text-gray-500">
                          No referrals yet. Share your code to start earning.
                        </td>
                      </tr>
                    )}
                    {referrals.map((r) => (
                      <tr key={r.id} className="border-t border-[var(--mezzo-border)] text-gray-200">
                        <td className="px-6 py-3">{r.referred_user}</td>
                        <td className="px-6 py-3 text-xs text-gray-400">
                          {r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-6 py-3">{fmt(r.bonus_amount)}</td>
                        <td className="px-6 py-3">
                          <StatusPill status={r.status === "rewarded" ? "paid" : r.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
