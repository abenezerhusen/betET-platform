"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ChevronDown,
  ChevronUp,
  Ticket,
  Trophy,
  ArrowLeftRight,
  LayoutDashboard,
  Settings,
  LogOut,
  Download,
  Search,
  User,
  Mail,
  FolderOpen,
  UserCircle,
  CircleDollarSign,
  Info,
  Lock,
  LockOpen,
  Calendar,
  Hash,
  DollarSign,
  Trash2
} from "lucide-react";
import {
  clearCashierSession,
  getCashierSession,
  loginCashier,
  cashierDeposit,
  listCashierTransactions,
  getCurrentShift,
  openShift,
  closeShift,
  changeCashierPassword,
  lookupCashierTicket,
  checkCashierTicketPayout,
  sellCashierTicket,
  payoutCashierTicket,
  cancelCashierTicket,
  removeCashierTicketLeg,
  listCashierTickets,
  listActiveJackpots,
  listJackpotTicketsToday,
  sellJackpotTicket,
  findPendingBranchWithdrawal,
  processBranchWithdrawal,
  getCashierDashboardStats,
  hasCashierPermission,
  ensureCashierPermission,
  onPermissionDenied,
  PERMISSION_DENIED_MESSAGE,
  verifyMyPassword,
  type CashierTicket,
  type CashierTicketCheck,
  type CashierJackpot,
  type CashierJackpotTicket,
  type CashierPendingWithdrawal,
  type CashierDashboardStats,
  type CashierTransactionRow,
  type CashierSession,
} from "@/lib/api";
import {
  ThermalTicketView,
  buildThermalTicketPrintHtml,
} from "@/components/ThermalTicketView";

// User-panel base URL for the "Launch Fixtures" sidebar shortcut. The
// cashier opens this in a new tab to build a bet slip on behalf of the
// walk-in player, copies the Ticket ID, then pastes it into Sell Ticket.
//
// NOTE: the fallback is port 3001 (the user panel), NOT 3000 — the
// cashier panel itself runs on 3000, so defaulting to 3000 would just
// re-open the cashier panel in the new tab. Override via
// NEXT_PUBLIC_USER_PANEL_URL for staging / production.
const USER_PANEL_URL =
  process.env.NEXT_PUBLIC_USER_PANEL_URL ?? "http://localhost:3001";

type PageType = "tickets" | "super-jackpots" | "withdraw-deposit" | "dashboard" | "settings";

export default function CashierPanel() {
  const [session, setSession] = useState<CashierSession | null>(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [username, setUsername] = useState("");
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [currentPage, setCurrentPage] = useState<PageType>("tickets");
  const [permissionDeniedMsg, setPermissionDeniedMsg] = useState<string | null>(null);

  useEffect(() => {
    const stored = getCashierSession();
    if (!stored) return;
    setSession(stored);
    setIsLoggedIn(true);
    setUsername(stored.login_username ?? stored.user.email ?? stored.user.phone ?? "Cashier");
  }, []);

  // Global permission-denied popup. Any action handler that calls
  // ensureCashierPermission(...) — or any backend 403 — surfaces the
  // spec-mandated message here.
  useEffect(() => {
    return onPermissionDenied((message) => setPermissionDeniedMsg(message));
  }, []);

  if (!isLoggedIn) {
    return <LoginPage onLogin={(cashierSession) => {
      setSession(cashierSession);
      setIsLoggedIn(true);
      setUsername(
        cashierSession.login_username ??
          cashierSession.user.email ??
          cashierSession.user.phone ??
          "Cashier"
      );
    }} />;
  }

  const perms = session?.user.permissions ?? [];
  const isWildcard = perms.includes("*");
  const hasNoPerms = !isWildcard && perms.length === 0;
  const grantedPermsLabel = isWildcard
    ? "All permissions"
    : perms.length > 0
    ? `${perms.length} granted`
    : "None granted";

  return (
    <div className="min-h-screen flex flex-col bg-gray-100">
      {/* Permission-denied popup (spec-mandated message). */}
      <Dialog
        open={permissionDeniedMsg !== null}
        onOpenChange={(open) => {
          if (!open) setPermissionDeniedMsg(null);
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <Lock className="w-5 h-5" /> Permission Required
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-gray-700 py-2">
            {permissionDeniedMsg ?? PERMISSION_DENIED_MESSAGE}
          </p>
          <DialogFooter>
            <Button
              onClick={() => setPermissionDeniedMsg(null)}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <header className="bg-[#2d2d2d] text-white h-16 flex items-center justify-between px-6 shadow-md">
        <div className="flex items-center gap-3">
          <div className="bg-white text-[#2d2d2d] px-4 py-2 rounded-md font-bold text-base tracking-tight">
            1BIRR<span className="text-green-600">.BET</span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <User className="w-4 h-4" />
          <span>{username}</span>
          {session?.tenant_id && (
            <>
              <span className="text-gray-400">|</span>
              <span className="text-gray-300">{session.tenant_id}</span>
            </>
          )}
          <span className="text-gray-400">|</span>
          <span
            className={`text-xs px-2 py-0.5 rounded ${
              hasNoPerms
                ? "bg-red-700 text-white"
                : isWildcard
                ? "bg-emerald-700 text-white"
                : "bg-blue-700 text-white"
            }`}
            title={
              isWildcard
                ? "Super admin — wildcard access"
                : perms.length === 0
                ? "Ask the admin to open Users → Sales Staff → Role Settings and grant the required permissions (sell_tickets, can_payout, etc.)."
                : perms.join(", ")
            }
          >
            Permissions: {grantedPermsLabel}
          </span>
        </div>
      </header>

      {hasNoPerms ? (
        <div className="bg-amber-100 border-b border-amber-300 text-amber-900 text-sm px-6 py-3">
          <strong>No permissions granted yet.</strong> Each action will show a
          permission popup until an admin opens <em>Admin Panel → Users → Sales
          Staff → Role Settings</em> for this account and saves the required
          permissions (e.g. <code>sell_tickets</code>, <code>can_payout</code>,
          <code>cancel_tickets</code>, <code>deposit</code>,{" "}
          <code>withdraw</code>). After saving, log out and back in here to
          refresh.
        </div>
      ) : null}

      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-52 bg-white border-r border-gray-200 flex flex-col shadow-sm">
          <div
            className="flex items-center justify-between p-4 border-b border-gray-200 cursor-pointer hover:bg-gray-50 transition-colors"
            onClick={() => setSidebarExpanded(!sidebarExpanded)}
          >
            <div className="flex items-center gap-2.5 text-gray-700">
              <div className="w-5 h-5 flex flex-col justify-center gap-1">
                <div className="h-0.5 bg-gray-600 rounded"></div>
                <div className="h-0.5 bg-gray-600 rounded"></div>
                <div className="h-0.5 bg-gray-600 rounded"></div>
              </div>
              <span className="font-medium text-sm">Options</span>
            </div>
            {sidebarExpanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
          </div>

          {sidebarExpanded && (
            <nav className="flex-1 py-1">
              <NavItem
                icon={<Ticket className="w-5 h-5" />}
                label="Tickets"
                active={currentPage === "tickets"}
                onClick={() => setCurrentPage("tickets")}
              />
              <NavItem
                icon={<Trophy className="w-5 h-5" />}
                label="Super Jackpots"
                active={currentPage === "super-jackpots"}
                onClick={() => setCurrentPage("super-jackpots")}
                highlight
              />
              <NavItem
                icon={<ArrowLeftRight className="w-5 h-5" />}
                label="Withdraw/Deposit"
                active={currentPage === "withdraw-deposit"}
                onClick={() => setCurrentPage("withdraw-deposit")}
                highlight
              />
              <NavItem
                icon={<LayoutDashboard className="w-5 h-5" />}
                label="Dashboard"
                active={currentPage === "dashboard"}
                onClick={() => setCurrentPage("dashboard")}
                highlight
              />
              <NavItem
                icon={<Settings className="w-5 h-5" />}
                label="Setting"
                active={currentPage === "settings"}
                onClick={() => setCurrentPage("settings")}
                highlight
              />
              <NavItem
                icon={<LogOut className="w-5 h-5" />}
                label="Logout"
                onClick={() => {
                  clearCashierSession();
                  setDashboardUnlocked(false);
                  setSession(null);
                  setIsLoggedIn(false);
                  setUsername("");
                  setCurrentPage("tickets");
                }}
              />
              <NavItem icon={<Download className="w-5 h-5" />} label="Download Fixture" />
            </nav>
          )}

          <div className="p-4 border-t border-gray-200 text-xs text-gray-500 font-semibold">
            VERSION 8.1
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-8 overflow-auto bg-gray-50">
          {currentPage === "tickets" && <TicketsPage />}
          {currentPage === "super-jackpots" && <SuperJackpotsPage />}
          {currentPage === "withdraw-deposit" && <WithdrawDepositPage />}
          {currentPage === "dashboard" && <DashboardPage username={username} />}
          {currentPage === "settings" && <SettingsPage />}
        </main>

        {/* Right Sidebar - Hide on Dashboard and Settings */}
        {currentPage !== "dashboard" && currentPage !== "settings" && (
          <aside className="w-96 bg-white border-l border-gray-200 flex flex-col shadow-sm">
            {currentPage === "tickets" && <TicketsRightSidebar />}
            {currentPage === "super-jackpots" && <JackpotsRightSidebar />}
            {currentPage === "withdraw-deposit" && <RecentTransactionsRightSidebar />}
          </aside>
        )}
      </div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active = false,
  onClick,
  highlight = false
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-gray-50 transition-colors ${
        active
          ? highlight
            ? "text-yellow-600 bg-yellow-50 border-l-4 border-yellow-500"
            : "text-blue-600 bg-blue-50 border-l-4 border-blue-600"
          : "text-gray-700 border-l-4 border-transparent"
      }`}
    >
      <div className="w-5 h-5 flex items-center justify-center">{icon}</div>
      <span className={highlight && active ? "font-semibold" : ""}>{label}</span>
    </button>
  );
}

function TicketsPage() {
  const [activeTab, setActiveTab] = useState("sell");
  const [couponCode, setCouponCode] = useState("");
  const [payoutCode, setPayoutCode] = useState("");
  // Refs used to auto-focus the Ticket ID input whenever the user switches
  // tabs. USB / Bluetooth barcode scanners are HID keyboard-wedge devices
  // that type the scanned text into whichever input has focus and send an
  // Enter key. Both inputs already handle Enter to trigger Lookup / Check
  // Ticket, so focusing them on tab change makes scanning a single-step
  // operation with zero extra clicks. Manual typing is unchanged.
  const sellInputRef = useRef<HTMLInputElement>(null);
  const payoutInputRef = useRef<HTMLInputElement>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [ticket, setTicket] = useState<CashierTicket | null>(null);
  const [payoutInfo, setPayoutInfo] = useState<CashierTicketCheck | null>(null);
  const [printLoading, setPrintLoading] = useState(false);
  const [payoutBusy, setPayoutBusy] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [removeLegBusy, setRemoveLegBusy] = useState<number | null>(null);

  const session = getCashierSession();
  const branchLabel =
    session?.branch?.branch_code ||
    session?.branch?.label ||
    "—";
  const cashierLabel =
    session?.login_username ||
    session?.user?.email ||
    session?.user?.phone ||
    "Cashier";

  // Auto-focus the Ticket ID input for the active tab so a barcode scan
  // is captured immediately — no need to click into the field first.
  // Triggered on mount and whenever the user switches between Sell and
  // Payout & Cancel. Wrapped in rAF so the input is mounted before we
  // call .focus() (the inactive TabsContent unmounts in shadcn-ui).
  useEffect(() => {
    const target = activeTab === "payout" ? payoutInputRef : sellInputRef;
    const handle = window.requestAnimationFrame(() => {
      target.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(handle);
  }, [activeTab]);

  // ─── Global barcode-scanner capture ────────────────────────────────
  // USB / Bluetooth barcode scanners are HID keyboard-wedge devices —
  // they type the decoded text into whichever element has focus, then
  // send Enter. The problem: focus on the cashier page can drift
  // anywhere (action button, tab strip, etc.), and the scanner's
  // keystrokes get lost.
  //
  // This handler watches `keydown` at the document root. When it sees
  // characters arriving faster than humanly possible (gap ≤ 50 ms) it
  // assembles a buffer until an Enter arrives, then runs the active
  // tab's lookup directly with the decoded value. Manual typing is
  // unaffected because human keystrokes are always > 50 ms apart so
  // they never enter scanner mode.
  //
  // We intentionally read the latest values via refs so this effect
  // does not re-bind on every render.
  const activeTabRef = useRef(activeTab);
  const couponLoadingRef = useRef(false);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { couponLoadingRef.current = couponLoading; }, [couponLoading]);
  const runLookupRef = useRef<(code: string) => Promise<void>>(async () => {});
  const runCheckPayoutRef = useRef<(code: string) => Promise<void>>(async () => {});

  useEffect(() => {
    let buffer = "";
    let lastKeyAt = 0;
    const SCAN_GAP_MS = 50;

    const handler = (e: KeyboardEvent) => {
      // Ignore modifier/navigation keys — only printable chars + Enter
      // should be treated as scanner input.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isInput =
        tag === "input" || tag === "textarea" || tag === "select";

      const now = performance.now();
      const gap = now - lastKeyAt;
      lastKeyAt = now;

      if (e.key === "Enter") {
        if (buffer.length >= 4) {
          // Looks like a scanner-completed code. Route it to the active
          // tab's lookup regardless of what currently has focus.
          const code = buffer;
          buffer = "";
          if (couponLoadingRef.current) return;
          e.preventDefault();
          if (activeTabRef.current === "payout") {
            setPayoutCode(code);
            void runCheckPayoutRef.current(code);
          } else {
            setCouponCode(code);
            void runLookupRef.current(code);
          }
        } else {
          buffer = "";
        }
        return;
      }

      // Only single-character printable keys count as data.
      if (e.key.length !== 1) {
        buffer = "";
        return;
      }

      // First key starts the buffer; subsequent keys must arrive within
      // SCAN_GAP_MS or we treat it as fresh human typing.
      if (gap > SCAN_GAP_MS && buffer.length > 0) {
        buffer = "";
      }

      // Don't interfere with a focused input that's already receiving
      // characters at human speed (manual typing) — only intercept if
      // the input isn't focused or the rate looks like a scanner.
      const looksLikeScanner = gap <= SCAN_GAP_MS || buffer.length === 0;
      if (!looksLikeScanner && isInput) return;

      buffer += e.key;
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  const fmtDate = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleString() : "—";
  const fmtDateOnly = (iso: string | null | undefined) =>
    iso ? new Date(iso).toLocaleDateString() : "—";

  // A ticket can only be cancelled while every match is still upcoming.
  // Returns true if at least one leg has already kicked off.
  const ticketHasStartedMatch = (t: CashierTicket | null): boolean => {
    if (!t || !Array.isArray(t.selections)) return false;
    const now = Date.now();
    return (t.selections as Array<Record<string, unknown>>).some((s) => {
      const startsRaw = s?.starts_at as string | undefined;
      if (!startsRaw) return false;
      const ms = new Date(startsRaw).getTime();
      return !Number.isNaN(ms) && ms <= now;
    });
  };

  const printTicketSlip = (t: CashierTicket) => {
    const html = buildThermalTicketPrintHtml({
      ticket: t,
      cashierName: cashierLabel,
      branchLabel,
    });
    const win = window.open("", "_blank", "width=340,height=700");
    if (!win) {
      throw new Error("Popup blocked. Please allow popups and try again.");
    }
    win.document.write(html);
    win.document.close();
    win.focus();
    // Print is triggered by the window.onload handler embedded in the
    // HTML above. Calling win.print() synchronously here would race the
    // PNG barcode decoder and print a blank barcode slot.
  };

  const runLookup = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed || couponLoading) return;
    setCouponLoading(true);
    setCouponError("");
    setActionMessage("");
    setTicket(null);
    setPayoutInfo(null);
    try {
      const out = await lookupCashierTicket(trimmed);
      setTicket(out);
      // Pre-fetch payout evaluation only when we're on the payout tab.
      if (activeTab === "payout") {
        try {
          const ev = await checkCashierTicketPayout(trimmed);
          setPayoutInfo(ev);
        } catch {
          /* ignored — UI just won't show payout block */
        }
      }
    } catch (err) {
      setCouponError((err as Error).message || "Ticket not found.");
    } finally {
      setCouponLoading(false);
      // Re-focus the active Ticket ID input so the cashier can scan the
      // next ticket immediately without clicking back into the field.
      window.requestAnimationFrame(() => {
        const ref = activeTabRef.current === "payout" ? payoutInputRef : sellInputRef;
        ref.current?.focus({ preventScroll: true });
        ref.current?.select?.();
      });
    }
  };

  const printTicket = async (ticketId: string) => {
    const id = ticketId.trim();
    if (!id || printLoading) return;
    if (!ensureCashierPermission("sell_tickets")) return;
    setCouponError("");
    setActionMessage("");
    setPrintLoading(true);
    try {
      // Look up if we don't already have it.
      let current = ticket;
      if (!current || current.ticket_id !== id) {
        current = await lookupCashierTicket(id);
        setTicket(current);
      }
      // Mark the ticket as sold (idempotent on the server).
      try {
        const out = await sellCashierTicket(id);
        if (out?.ticket) setTicket(out.ticket);
        printTicketSlip(out?.ticket ?? current);
      } catch (err) {
        // Sell failed — still print the receipt the cashier can show
        // the player, surface the error too so they know.
        setCouponError((err as Error).message || "Failed to mark ticket sold.");
        printTicketSlip(current);
      }
    } catch (err) {
      setCouponError((err as Error).message || "Failed to print ticket.");
    } finally {
      setPrintLoading(false);
    }
  };

  const runCheckPayout = async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setCouponError("");
    setActionMessage("");
    setCouponLoading(true);
    try {
      const ev = await checkCashierTicketPayout(trimmed);
      setPayoutInfo(ev);
      const t = await lookupCashierTicket(trimmed);
      setTicket(t);
    } catch (err) {
      setCouponError((err as Error).message || "Ticket not found.");
    } finally {
      setCouponLoading(false);
      // Re-focus the Payout input so the next scan goes straight in.
      window.requestAnimationFrame(() => {
        payoutInputRef.current?.focus({ preventScroll: true });
        payoutInputRef.current?.select?.();
      });
    }
  };

  // Wire up the function refs used by the global scanner-capture
  // listener installed above. We assign on every render so the refs
  // always point at the latest closure (which captures up-to-date state).
  runLookupRef.current = runLookup;
  runCheckPayoutRef.current = runCheckPayout;

  const payTicket = async () => {
    if (!payoutInfo || payoutBusy) return;
    if (!ensureCashierPermission("can_payout")) return;
    setPayoutBusy(true);
    setCouponError("");
    try {
      const out = await payoutCashierTicket(payoutInfo.ticket_id);
      setTicket(out.ticket);
      setPayoutInfo({
        ...payoutInfo,
        status: "already_paid",
        paid_at: out.ticket.paid_at,
      });
      setActionMessage(
        `Paid ${out.currency} ${out.paid_amount.toFixed(2)} for ticket ${out.ticket.ticket_id}.`,
      );
    } catch (err) {
      setCouponError((err as Error).message || "Payout failed.");
    } finally {
      setPayoutBusy(false);
    }
  };

  const cancelTicket = async () => {
    if (!ticket || cancelBusy) return;
    if (!ensureCashierPermission("cancel_tickets")) return;
    setCancelBusy(true);
    setCouponError("");
    try {
      const out = await cancelCashierTicket(ticket.ticket_id);
      setTicket(out.ticket);
      setActionMessage(
        `Cancelled. ${out.currency} ${out.refunded.toFixed(2)} refunded to player.`,
      );
    } catch (err) {
      setCouponError((err as Error).message || "Cancel failed.");
    } finally {
      setCancelBusy(false);
    }
  };

  const removeLeg = async (index: number, label: string) => {
    if (!ticket || removeLegBusy !== null) return;
    if (!ensureCashierPermission("sell_tickets")) return;
    setRemoveLegBusy(index);
    setCouponError("");
    setActionMessage("");
    try {
      const out = await removeCashierTicketLeg(ticket.ticket_id, index);
      setTicket(out.ticket);
      setActionMessage(
        `Removed ${out.removed_match || label || "match"}. Ticket re-priced.`,
      );
    } catch (err) {
      setCouponError((err as Error).message || "Could not remove the match.");
    } finally {
      setRemoveLegBusy(null);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 max-w-2xl">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-6 bg-gray-100 p-1 h-auto">
          <TabsTrigger
            value="sell"
            className="data-[state=active]:bg-white data-[state=active]:text-blue-600 text-gray-600 font-medium py-2.5"
          >
            Sell Ticket
          </TabsTrigger>
          <TabsTrigger
            value="payout"
            className="data-[state=active]:bg-white data-[state=active]:text-blue-600 text-gray-600 font-medium py-2.5"
          >
            Payout and Cancel
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sell" className="space-y-6 mt-4">
          <div className="relative">
            <Input
              ref={sellInputRef}
              placeholder="Scan or type Ticket ID"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                void runLookup((e.target as HTMLInputElement).value)
              }
              className="pr-10 h-11 border-gray-300"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          </div>
          <div className="flex gap-3">
            <Button
              onClick={() => void runLookup(couponCode)}
              disabled={couponLoading || !couponCode.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {couponLoading ? "Checking..." : "Lookup Ticket"}
            </Button>
            <Button
              onClick={() => void printTicket(couponCode)}
              disabled={
                printLoading ||
                !couponCode.trim()
              }
              title={
                hasCashierPermission("sell_tickets")
                  ? undefined
                  : "Admin has not granted Sell Tickets permission for this account."
              }
              className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
            >
              {printLoading ? "Preparing..." : "Print Ticket"}
            </Button>
          </div>

          {couponError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {couponError}
            </div>
          ) : null}
          {actionMessage ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {actionMessage}
            </div>
          ) : null}

          {ticket ? (
            <div className="space-y-3">
              <div
                className="rounded-md border border-gray-200 bg-white p-2 shadow-sm"
                style={{ overflow: "hidden" }}
              >
                <ThermalTicketView
                  ticket={ticket}
                  cashierName={cashierLabel}
                  branchLabel={branchLabel}
                />
              </div>
              <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-xs text-gray-600 grid grid-cols-2 gap-x-4 gap-y-1">
                <span className="font-semibold">Ticket ID</span>
                <span className="font-mono">{ticket.ticket_id}</span>
                <span className="font-semibold">Status</span>
                <span>{ticket.status.toUpperCase()}</span>
                <span className="font-semibold">Issued</span>
                <span>{fmtDate(ticket.issued_at)}</span>
                <span className="font-semibold">Expires</span>
                <span>
                  {fmtDateOnly(ticket.expires_at)} ({ticket.expiry_days} days)
                </span>
                {ticket.sold_at ? (
                  <>
                    <span className="font-semibold">Sold At</span>
                    <span>{fmtDate(ticket.sold_at)}</span>
                  </>
                ) : null}
              </div>

              {(() => {
                const editable =
                  (ticket.raw_status === "pending" ||
                    ticket.raw_status === "accepted") &&
                  !ticket.paid_at &&
                  Array.isArray(ticket.selections) &&
                  ticket.selections.length > 1;
                if (!editable) return null;
                const now = Date.now();
                return (
                  <div className="rounded-md border border-gray-200 bg-white p-3">
                    <div className="mb-2 text-sm font-semibold text-gray-700">
                      Adjust selections
                    </div>
                    <p className="mb-3 text-xs text-gray-500">
                      Remove a match that has not started yet. The ticket is
                      re-priced automatically.
                    </p>
                    <ul className="space-y-2">
                      {(ticket.selections as Array<Record<string, unknown>>).map(
                        (sel, idx) => {
                          const matchLabel =
                            (sel.match as string) ||
                            [sel.home_team, sel.away_team]
                              .filter(Boolean)
                              .join(" v ") ||
                            `Match ${idx + 1}`;
                          const pick = (sel.selection as string) || "";
                          const odds = Number(sel.odds ?? 0);
                          const startsRaw = sel.starts_at as string | undefined;
                          const startsAt = startsRaw
                            ? new Date(startsRaw)
                            : null;
                          const started =
                            !startsAt ||
                            Number.isNaN(startsAt.getTime()) ||
                            startsAt.getTime() <= now;
                          return (
                            <li
                              key={idx}
                              className="flex items-center justify-between gap-3 rounded border border-gray-100 bg-gray-50 px-3 py-2"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-gray-800">
                                  {matchLabel}
                                </div>
                                <div className="truncate text-xs text-gray-500">
                                  {pick}
                                  {odds > 0 ? ` @ ${odds.toFixed(2)}` : ""}
                                  {startsAt && !Number.isNaN(startsAt.getTime())
                                    ? ` · ${startsAt.toLocaleString()}`
                                    : ""}
                                </div>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void removeLeg(idx, matchLabel)}
                                disabled={started || removeLegBusy !== null}
                                title={
                                  started
                                    ? "This match has started and cannot be removed."
                                    : "Remove this match from the ticket"
                                }
                                className="shrink-0 border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40"
                              >
                                <Trash2 className="mr-1 h-3.5 w-3.5" />
                                {removeLegBusy === idx ? "Removing..." : "Remove"}
                              </Button>
                            </li>
                          );
                        },
                      )}
                    </ul>
                  </div>
                );
              })()}
            </div>
          ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="relative mb-6">
              <div className="w-24 h-28 bg-gray-50 rounded-lg flex items-center justify-center border-2 border-dashed border-gray-300">
                <div className="space-y-2">
                  <div className="w-14 h-1 bg-gray-300 mx-auto rounded"></div>
                  <div className="w-14 h-1 bg-gray-300 mx-auto rounded"></div>
                  <div className="w-14 h-1 bg-gray-300 mx-auto rounded"></div>
                </div>
              </div>
              <div className="absolute -top-2 -right-2 w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center border-3 border-white shadow-sm">
                <div className="flex gap-0.5">
                  <div className="w-1 h-1 bg-gray-500 rounded-full"></div>
                  <div className="w-1 h-1 bg-gray-500 rounded-full"></div>
                  <div className="w-1 h-1 bg-gray-500 rounded-full"></div>
                </div>
              </div>
            </div>
            <p className="text-gray-600 text-sm">Please provide valid ticket number.</p>
          </div>
          )}
        </TabsContent>

        <TabsContent value="payout" className="space-y-6 mt-4">
          <div className="flex gap-3">
            <div className="relative flex-1">
              <Input
                ref={payoutInputRef}
                placeholder="Scan or type Ticket ID"
                value={payoutCode}
                onChange={(e) => setPayoutCode(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  void runCheckPayout((e.target as HTMLInputElement).value)
                }
                className="pr-10 h-11 border-gray-300"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
              />
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            </div>
          </div>
          <div className="flex gap-3 flex-wrap">
            <Button
              onClick={() => void runCheckPayout(payoutCode)}
              disabled={couponLoading || !payoutCode.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {couponLoading ? "Checking..." : "Check Ticket"}
            </Button>
            {payoutInfo && (payoutInfo.status === "won" || payoutInfo.status === "cashback") ? (
              <Button
                onClick={() => void payTicket()}
                disabled={payoutBusy}
                title={
                  hasCashierPermission("can_payout")
                    ? undefined
                    : "Admin has not granted Payout permission for this account."
                }
                className="bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
              >
                {payoutBusy
                  ? "Paying..."
                  : `Pay ${payoutInfo.currency} ${payoutInfo.payout_amount.toFixed(2)}`}
              </Button>
            ) : null}
            {ticket && (ticket.raw_status === "pending" || ticket.raw_status === "accepted") ? (
              <Button
                onClick={() => void cancelTicket()}
                disabled={cancelBusy || ticketHasStartedMatch(ticket)}
                title={
                  !hasCashierPermission("cancel_tickets")
                    ? "Admin has not granted Cancel Tickets permission for this account."
                    : ticketHasStartedMatch(ticket)
                      ? "This ticket cannot be cancelled — one of its matches has already started."
                      : undefined
                }
                variant="outline"
                className="border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                {cancelBusy ? "Cancelling..." : "Cancel & Refund"}
              </Button>
            ) : null}
          </div>

          {couponError ? (
            <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {couponError}
            </div>
          ) : null}
          {actionMessage ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {actionMessage}
            </div>
          ) : null}

          {payoutInfo ? (
            <div className={`rounded-md border p-4 text-sm space-y-2 ${
              payoutInfo.status === "won" || payoutInfo.status === "cashback"
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : payoutInfo.status === "lost"
                ? "border-red-200 bg-red-50 text-red-700"
                : payoutInfo.status === "expired"
                ? "border-amber-200 bg-amber-50 text-amber-800"
                : payoutInfo.status === "already_paid"
                ? "border-gray-200 bg-gray-100 text-gray-800"
                : "border-blue-200 bg-blue-50 text-blue-800"
            }`}>
              <p className="font-bold text-base">
                {payoutInfo.status === "won" && `✓ WON — ${payoutInfo.payout_amount.toFixed(2)} ${payoutInfo.currency}`}
                {payoutInfo.status === "cashback" && `↻ CASHBACK — ${payoutInfo.payout_amount.toFixed(2)} ${payoutInfo.currency}`}
                {payoutInfo.status === "lost" && "✗ LOST — No payout."}
                {payoutInfo.status === "expired" && `⏰ EXPIRED — payout window was ${payoutInfo.expiry_days} days`}
                {payoutInfo.status === "already_paid" && "This ticket has already been paid out."}
                {payoutInfo.status === "pending" && "Pending — outcome not yet known."}
                {payoutInfo.status === "void" && "Voided."}
              </p>
              <p><strong>Ticket ID:</strong> {payoutInfo.ticket_id}</p>
              <p><strong>Issued:</strong> {fmtDate(payoutInfo.issued_at)}</p>
              <p><strong>Expires:</strong> {fmtDateOnly(payoutInfo.expires_at)}</p>
              <p><strong>Stake:</strong> {payoutInfo.stake.toFixed(2)} {payoutInfo.currency}</p>
              {payoutInfo.paid_at ? (
                <p><strong>Paid:</strong> {fmtDate(payoutInfo.paid_at)}</p>
              ) : null}
            </div>
          ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="relative mb-6">
              <div className="w-24 h-28 bg-gray-50 rounded-lg flex items-center justify-center border-2 border-dashed border-gray-300">
                <div className="space-y-2">
                  <div className="w-14 h-1 bg-gray-300 mx-auto rounded"></div>
                  <div className="w-14 h-1 bg-gray-300 mx-auto rounded"></div>
                  <div className="w-14 h-1 bg-gray-300 mx-auto rounded"></div>
                </div>
              </div>
              <div className="absolute -top-2 -right-2 w-10 h-10 bg-gray-200 rounded-full flex items-center justify-center border-3 border-white shadow-sm">
                <div className="flex gap-0.5">
                  <div className="w-1 h-1 bg-gray-500 rounded-full"></div>
                  <div className="w-1 h-1 bg-gray-500 rounded-full"></div>
                  <div className="w-1 h-1 bg-gray-500 rounded-full"></div>
                </div>
              </div>
            </div>
            <p className="text-gray-600 text-sm">Please provide a valid ticket number.</p>
          </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SuperJackpotsPage() {
  const [active, setActive] = useState<CashierJackpot[]>([]);
  const [activeLoading, setActiveLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [phone, setPhone] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [sellBusy, setSellBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadActive = useCallback(async () => {
    setActiveLoading(true);
    try {
      const out = await listActiveJackpots();
      setActive(out.items);
      if (!selectedId && out.items.length > 0) {
        setSelectedId(out.items[0].id);
      }
    } catch (err) {
      setFeedback({
        type: "error",
        text: (err as Error).message || "Failed to load jackpots.",
      });
    } finally {
      setActiveLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadActive();
  }, [loadActive]);

  const selected = active.find((j) => j.id === selectedId) ?? null;

  const handleSell = async () => {
    if (!selectedId || sellBusy) return;
    if (!ensureCashierPermission("sell_jackpots")) return;
    setSellBusy(true);
    setFeedback(null);
    try {
      const out = await sellJackpotTicket(selectedId, {
        quantity,
        player_phone: phone.trim() || undefined,
      });
      setFeedback({
        type: "success",
        text: `Sold ${out.quantity} × ${out.jackpot_name} (${out.total_stake.toFixed(2)} ${out.currency}). First ticket: ${out.tickets[0]?.ticket_code ?? "n/a"}`,
      });
      setPhone("");
      setQuantity(1);
    } catch (err) {
      setFeedback({
        type: "error",
        text: (err as Error).message || "Sale failed.",
      });
    } finally {
      setSellBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 max-w-2xl">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">Super Jackpots</h2>

      {feedback ? (
        <div
          className={`mb-4 rounded-md border px-4 py-3 text-sm ${
            feedback.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {feedback.text}
        </div>
      ) : null}

      {activeLoading ? (
        <p className="text-sm text-gray-500">Loading active jackpots…</p>
      ) : active.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderOpen className="w-16 h-16 text-gray-300 mb-3" strokeWidth={1.5} />
          <p className="text-gray-500 text-sm">
            No jackpots are currently on sale.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Jackpot
            </label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(e.target.value)}
              className="w-full h-11 px-3 border border-gray-300 rounded-md text-sm"
            >
              {active.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.name} — entry {j.entry_fee} {j.currency}
                </option>
              ))}
            </select>
          </div>

          {selected ? (
            <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 space-y-1">
              <p>
                <strong>Prize Pool:</strong> {selected.prize_pool} {selected.currency}
              </p>
              <p>
                <strong>Ends:</strong>{" "}
                {selected.ends_at
                  ? new Date(selected.ends_at).toLocaleString()
                  : "—"}
              </p>
              <p>
                <strong>Tickets Sold:</strong> {selected.tickets_sold ?? "0"}
                {selected.max_entries
                  ? ` / ${selected.max_entries}`
                  : ""}
              </p>
            </div>
          ) : null}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Player Phone (optional)
            </label>
            <Input
              placeholder="09xxxxxxxx"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="h-11 border-gray-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tickets
            </label>
            <Input
              type="number"
              min={1}
              max={50}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="h-11 border-gray-300 w-24"
            />
          </div>

          <Button
            onClick={() => void handleSell()}
            disabled={
              sellBusy || !selectedId
            }
            title={
              hasCashierPermission("sell_jackpots")
                ? undefined
                : "Admin has not granted Sell Jackpots permission for this account."
            }
            className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
          >
            {sellBusy ? "Selling…" : "Sell Jackpot Ticket"}
          </Button>
        </div>
      )}
    </div>
  );
}

function TicketsRightSidebar() {
  const [slips, setSlips] = useState<CashierTicket[]>([]);
  const [slipsLoading, setSlipsLoading] = useState(false);

  const handleLaunchFixtures = () => {
    // Section 16 Flow B: cashier opens the user panel in a new tab,
    // builds the bet slip on behalf of the walk-in player, copies the
    // generated Ticket ID, returns here and pastes it into Sell Ticket.
    window.open(USER_PANEL_URL, "_blank", "noopener,noreferrer");
  };

  const loadSlips = useCallback(async () => {
    setSlipsLoading(true);
    try {
      const out = await listCashierTickets({
        date: "today",
        mine: true,
        limit: 50,
      });
      setSlips(out.items);
    } catch {
      setSlips([]);
    } finally {
      setSlipsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSlips();
  }, [loadSlips]);

  const filterByStatus = (statuses: string[]) =>
    slips.filter((s) => statuses.includes(s.raw_status));

  const renderRow = (t: CashierTicket) => (
    <div
      key={t.bet_id}
      className="grid grid-cols-3 gap-2 text-xs border-b border-gray-100 px-2 py-2"
    >
      <div className="font-mono truncate text-gray-700">{t.ticket_id}</div>
      <div className="text-gray-600">
        {t.stake.toFixed(2)} {t.currency}
      </div>
      <div className="text-right">
        <span
          className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase ${
            t.raw_status === "won" || t.raw_status === "partial_won"
              ? "bg-emerald-100 text-emerald-700"
              : t.raw_status === "cancelled" || t.raw_status === "void"
              ? "bg-red-100 text-red-700"
              : t.raw_status === "lost"
              ? "bg-gray-200 text-gray-700"
              : "bg-blue-100 text-blue-700"
          }`}
        >
          {t.raw_status}
        </span>
      </div>
    </div>
  );

  return (
    <>
      <div className="bg-gradient-to-br from-[#1a3554] to-[#2d5a8c] p-6 text-white">
        <p className="text-sm mb-3.5 leading-relaxed">
          Click the button below to launch the game fixtures
        </p>
        <Button
          onClick={handleLaunchFixtures}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 h-auto shadow-lg"
        >
          Launch Fixtures
        </Button>
      </div>

      <div className="p-6 flex-1">
        <h2 className="text-xl font-semibold text-gray-800 mb-4">Today Slips</h2>

        <Tabs defaultValue="all" className="w-full">
          <TabsList className="grid w-full grid-cols-3 mb-6 bg-gray-100 p-1 h-auto">
            <TabsTrigger
              value="inbox"
              className="text-xs data-[state=active]:bg-blue-600 data-[state=active]:text-white px-2 py-2"
            >
              <Mail className="w-3 h-3 mr-1" />
              Inbox
            </TabsTrigger>
            <TabsTrigger
              value="cancelled"
              className="text-xs data-[state=active]:bg-blue-600 data-[state=active]:text-white px-2 py-2"
            >
              Cancelled
            </TabsTrigger>
            <TabsTrigger
              value="all"
              className="text-xs data-[state=active]:bg-blue-600 data-[state=active]:text-white px-2 py-2"
            >
              All Slips
            </TabsTrigger>
          </TabsList>

          <TabsContent value="inbox" className="text-center py-12">
            <p className="text-gray-700 text-sm font-medium tracking-wide">
              NO MESSAGE FROM THE COMPANY YET.
            </p>
          </TabsContent>

          <TabsContent value="cancelled">
            {slipsLoading ? (
              <p className="text-center py-10 text-sm text-gray-500">Loading…</p>
            ) : filterByStatus(["cancelled", "void"]).length === 0 ? (
              <p className="text-center py-10 text-sm text-gray-500">
                No cancelled slips
              </p>
            ) : (
              <div>{filterByStatus(["cancelled", "void"]).map(renderRow)}</div>
            )}
          </TabsContent>

          <TabsContent value="all">
            {slipsLoading ? (
              <p className="text-center py-10 text-sm text-gray-500">Loading…</p>
            ) : slips.length === 0 ? (
              <p className="text-center py-10 text-sm text-gray-500">
                No slips today
              </p>
            ) : (
              <div>{slips.map(renderRow)}</div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

function JackpotsRightSidebar() {
  const [today, setToday] = useState<CashierJackpotTicket[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listJackpotTicketsToday(true)
      .then((out) => {
        if (!cancelled) setToday(out.items);
      })
      .catch(() => {
        if (!cancelled) setToday([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-6 flex-1 flex flex-col">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Today Jackpots</h2>

      <div className="border border-gray-200 rounded-lg overflow-hidden flex-1 flex flex-col">
        <div className="grid grid-cols-3 bg-gray-50 border-b border-gray-200">
          <div className="px-3 py-3 text-xs font-medium text-gray-700">Ticket</div>
          <div className="px-3 py-3 text-xs font-medium text-gray-700">Stake</div>
          <div className="px-3 py-3 text-xs font-medium text-gray-700">Jackpot</div>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-16 bg-white">
            <p className="text-gray-500 text-sm">Loading…</p>
          </div>
        ) : today.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16 bg-white">
            <FolderOpen className="w-16 h-16 text-gray-300 mb-3" strokeWidth={1.5} />
            <p className="text-gray-400 text-sm">No Data</p>
          </div>
        ) : (
          <div className="bg-white">
            {today.map((t) => (
              <div
                key={t.id}
                className="grid grid-cols-3 border-b border-gray-100"
              >
                <div className="px-3 py-2 text-xs font-mono truncate text-gray-700">
                  {t.ticket_code}
                </div>
                <div className="px-3 py-2 text-xs text-gray-600">
                  {t.stake} {t.currency}
                </div>
                <div className="px-3 py-2 text-xs text-gray-600 truncate">
                  {t.jackpot_name ?? t.jackpot_id.slice(0, 8)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WithdrawDepositPage() {
  const session = getCashierSession();
  const branchUserId = session?.branch?.user_id?.trim() || undefined;

  const [depositPhone, setDepositPhone] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawCode, setWithdrawCode] = useState("");
  const [withdrawDialogOpen, setWithdrawDialogOpen] = useState(false);
  const [depositLoading, setDepositLoading] = useState(false);
  const [withdrawLoading, setWithdrawLoading] = useState(false);
  const [processBusy, setProcessBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [pendingWithdrawal, setPendingWithdrawal] = useState<CashierPendingWithdrawal | null>(null);

  const handleDeposit = async () => {
    if (!ensureCashierPermission("deposit")) return;
    setFeedback(null);
    const phone = depositPhone.trim();
    const amountNum = Number(depositAmount);
    if (!phone || !Number.isFinite(amountNum) || amountNum <= 0) {
      setFeedback({ type: "error", text: "Enter a valid receiver phone and amount." });
      return;
    }
    setDepositLoading(true);
    try {
      // Section 16: deposit endpoint accepts { phone, amount, branch_id }
      // directly; the backend resolves the phone → user_id internally.
      await cashierDeposit({
        phone,
        amount: amountNum,
        branch_id: branchUserId,
        payment_method: "cash",
        notes: `Cashier deposit for ${phone}`,
        idempotency_key: `cashier-deposit-${phone}-${Date.now()}`,
      });
      setDepositAmount("");
      setFeedback({ type: "success", text: `Deposit recorded for ${phone}.` });
    } catch (err) {
      setFeedback({ type: "error", text: (err as Error).message || "Deposit failed." });
    } finally {
      setDepositLoading(false);
    }
  };

  const handleLookupWithdrawal = async () => {
    if (!ensureCashierPermission("withdraw")) return;
    setFeedback(null);
    const code = withdrawCode.trim().toUpperCase();
    if (!code) {
      setFeedback({ type: "error", text: "Enter the player's withdrawal code." });
      return;
    }
    setWithdrawLoading(true);
    try {
      const out = await findPendingBranchWithdrawal(code);
      if (out.status !== "pending") {
        setFeedback({
          type: "error",
          text: `This code is ${out.status}. Ask the player to generate a fresh code.`,
        });
        setPendingWithdrawal(null);
        return;
      }
      setPendingWithdrawal(out);
      setWithdrawDialogOpen(true);
    } catch (err) {
      setFeedback({ type: "error", text: (err as Error).message || "Withdrawal lookup failed." });
    } finally {
      setWithdrawLoading(false);
    }
  };

  const handleProcessWithdrawal = async () => {
    if (!pendingWithdrawal || processBusy) return;
    if (!ensureCashierPermission("withdraw")) return;
    setProcessBusy(true);
    setFeedback(null);
    try {
      await processBranchWithdrawal(pendingWithdrawal.id);
      setFeedback({
        type: "success",
        text: `Paid ${pendingWithdrawal.amount.toFixed(2)} ${pendingWithdrawal.currency} to ${pendingWithdrawal.user_full_name ?? pendingWithdrawal.user_phone ?? "player"}.`,
      });
      setWithdrawDialogOpen(false);
      setPendingWithdrawal(null);
      setWithdrawCode("");
    } catch (err) {
      setFeedback({
        type: "error",
        text: (err as Error).message || "Process failed.",
      });
    } finally {
      setProcessBusy(false);
    }
  };

  return (
    <>
      <div className="max-w-2xl space-y-8">
        {feedback && (
          <div
            className={`rounded-md px-4 py-3 text-sm ${
              feedback.type === "success"
                ? "bg-green-50 text-green-700 border border-green-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {feedback.text}
          </div>
        )}
        {/* Deposit Money Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Deposit Money</h2>

          <div className="space-y-4">
            <div className="relative">
              <UserCircle className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Enter Receiver phonenumber"
                value={depositPhone}
                onChange={(e) => setDepositPhone(e.target.value)}
                className="pl-10 h-11 border-gray-300"
              />
              <Info className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            </div>

            <div className="relative">
              <CircleDollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Deposit Amount"
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="pl-10 h-11 border-gray-300"
              />
            </div>

            <Button
              onClick={() => void handleDeposit()}
              disabled={depositLoading}
              title={
                hasCashierPermission("deposit")
                  ? undefined
                  : "Admin has not granted Deposit permission for this account."
              }
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-11 shadow-md disabled:opacity-50"
            >
              {depositLoading ? "Processing..." : "Deposit"}
            </Button>
          </div>
        </div>

        {/* Withdraw Money Section (Section 16 — code-based) */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Withdraw Money</h2>

          <p className="text-xs text-gray-500 mb-4">
            Ask the player for the withdrawal code they generated on the
            user panel. Codes are single-use and expire after 72 hours.
          </p>

          <div className="space-y-4">
            <div className="relative">
              <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                placeholder="Enter withdrawal code (e.g. AB23CD78)"
                value={withdrawCode}
                onChange={(e) => setWithdrawCode(e.target.value.toUpperCase())}
                className="pl-10 h-11 border-gray-300 font-mono tracking-wider"
              />
            </div>

            <Button
              onClick={() => void handleLookupWithdrawal()}
              disabled={withdrawLoading}
              title={
                hasCashierPermission("withdraw")
                  ? undefined
                  : "Admin has not granted Withdraw permission for this account."
              }
              className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold h-11 shadow-md disabled:opacity-50"
            >
              {withdrawLoading ? "Checking..." : "Look Up Withdrawal"}
            </Button>
          </div>
        </div>
      </div>

      {/* Withdraw Confirmation Dialog */}
      <Dialog open={withdrawDialogOpen} onOpenChange={setWithdrawDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-semibold">Confirm Withdrawal</DialogTitle>
          </DialogHeader>

          {pendingWithdrawal ? (
            <div className="space-y-4 py-2">
              <div className="rounded-md border border-gray-200 bg-gray-50 p-4 text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-gray-500">Player</span>
                  <span className="font-semibold text-gray-800">
                    {pendingWithdrawal.user_full_name ??
                      pendingWithdrawal.user_phone ??
                      pendingWithdrawal.user_email ??
                      "Unknown"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Phone</span>
                  <span className="font-mono text-gray-800">
                    {pendingWithdrawal.user_phone ?? "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Code</span>
                  <span className="font-mono font-bold text-gray-800">
                    {pendingWithdrawal.code}
                  </span>
                </div>
                <div className="flex justify-between border-t border-gray-200 pt-2">
                  <span className="text-gray-700 font-medium">Amount</span>
                  <span className="text-lg font-bold text-gray-900">
                    {pendingWithdrawal.amount.toFixed(2)} {pendingWithdrawal.currency}
                  </span>
                </div>
              </div>
              <p className="text-xs text-gray-500">
                Hand the cash to the player and confirm to mark the
                withdrawal processed. This action is irreversible.
              </p>
            </div>
          ) : null}

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setWithdrawDialogOpen(false)}
              className="flex-1"
              disabled={processBusy}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleProcessWithdrawal()}
              className="flex-1 bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
              disabled={
                processBusy ||
                !pendingWithdrawal
              }
              title={
                hasCashierPermission("withdraw")
                  ? undefined
                  : "Admin has not granted Withdraw permission for this account."
              }
            >
              {processBusy ? "Processing…" : "Process Withdrawal"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RecentTransactionsRightSidebar() {
  const [rows, setRows] = useState<CashierTransactionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    listCashierTransactions({ page: 1, limit: 20 })
      .then((out) => {
        if (!cancelled) setRows(out.items ?? []);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || "Failed to load transactions.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="p-6 flex-1 flex flex-col">
      <h2 className="text-xl font-semibold text-gray-800 mb-4">Recent Transactions</h2>

      <div className="border border-gray-200 rounded-lg overflow-hidden flex-1 flex flex-col">
        {/* Table Header */}
        <div className="grid grid-cols-5 bg-gray-50 border-b border-gray-200">
          <div className="px-3 py-3 text-sm font-medium text-gray-700">ID</div>
          <div className="px-3 py-3 text-sm font-medium text-gray-700">Time</div>
          <div className="px-3 py-3 text-sm font-medium text-gray-700">Phone</div>
          <div className="px-3 py-3 text-sm font-medium text-gray-700">Type</div>
          <div className="px-3 py-3 text-sm font-medium text-gray-700">Amount</div>
        </div>

        <div className="flex-1 overflow-auto bg-white">
          {loading && <div className="p-4 text-sm text-gray-500">Loading transactions...</div>}
          {error && <div className="p-4 text-sm text-red-600">{error}</div>}
          {!loading && !error && rows.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16">
              <FolderOpen className="w-16 h-16 text-gray-300 mb-3" strokeWidth={1.5} />
              <p className="text-gray-400 text-sm">No Data</p>
            </div>
          )}
          {!loading &&
            !error &&
            rows.map((row) => (
              <div key={row.id} className="grid grid-cols-5 border-b border-gray-100 text-xs">
                <div className="px-3 py-2 font-mono truncate" title={row.id}>
                  {row.id.slice(0, 8)}
                </div>
                <div className="px-3 py-2">{new Date(row.created_at).toLocaleTimeString()}</div>
                <div className="px-3 py-2 truncate" title={row.user_id ?? "-"}>
                  {row.user_id ? row.user_id.slice(0, 8) : "-"}
                </div>
                <div className="px-3 py-2 capitalize">{row.type}</div>
                <div className="px-3 py-2 font-semibold">
                  {row.amount} {row.currency}
                </div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// Section 16 — once the cashier has unlocked the dashboard for this
// session we remember it in sessionStorage so navigating away and back
// doesn't keep re-prompting. The flag clears automatically on tab close
// (sessionStorage), and the parent panel clears it explicitly on logout.
const DASHBOARD_UNLOCK_KEY = "playcore-cashier-dashboard-unlocked";

function isDashboardUnlocked(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(DASHBOARD_UNLOCK_KEY) === "1";
}

function setDashboardUnlocked(unlocked: boolean) {
  if (typeof window === "undefined") return;
  if (unlocked) {
    window.sessionStorage.setItem(DASHBOARD_UNLOCK_KEY, "1");
  } else {
    window.sessionStorage.removeItem(DASHBOARD_UNLOCK_KEY);
  }
}

function DashboardPage({ username }: { username: string }) {
  const [credential, setCredential] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(() =>
    isDashboardUnlocked()
  );
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showMine, setShowMine] = useState(true);
  const [stats, setStats] = useState<CashierDashboardStats | null>(null);
  const [dashboardError, setDashboardError] = useState("");

  // Section 16 — Dashboard step-up. We verify the password against the
  // backend (so a stale in-memory value can't lock the operator out and
  // the secret never sits in memory beyond the type-and-verify cycle).
  // After a successful unlock we set a sessionStorage flag so the
  // operator isn't prompted again until they log out or close the tab.
  const handleUnlock = async () => {
    if (unlocking) return;
    if (credential.length === 0) {
      setUnlockError("Please enter your password.");
      return;
    }
    setUnlocking(true);
    setUnlockError("");
    try {
      const ok = await verifyMyPassword(credential);
      if (ok) {
        setDashboardUnlocked(true);
        setIsAuthenticated(true);
        setCredential("");
      } else {
        setUnlockError("Incorrect password. Please use your login password.");
      }
    } catch (err) {
      setUnlockError(
        (err as Error)?.message ||
          "Could not verify your password. Please try again.",
      );
    } finally {
      setUnlocking(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const loadStats = useCallback(async () => {
    try {
      setDashboardError("");
      const out = await getCashierDashboardStats({
        from: startDate ? new Date(startDate).toISOString() : undefined,
        to: endDate ? new Date(endDate).toISOString() : undefined,
        mine: showMine,
      });
      setStats(out);
    } catch (err) {
      setDashboardError(
        (err as Error).message || "Failed to load dashboard data.",
      );
    }
  }, [startDate, endDate, showMine]);

  const handleFilter = () => {
    void loadStats();
  };

  useEffect(() => {
    if (!isAuthenticated) return;
    void loadStats();
  }, [isAuthenticated, loadStats]);

  if (!isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-[600px]">
        <div className="bg-white rounded-lg border-2 border-gray-300 p-12 max-w-xl w-full">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-24 h-24 mb-6">
              <Lock className="w-20 h-20 text-gray-600" strokeWidth={2} />
            </div>
            <h2 className="text-2xl font-semibold text-gray-800 mb-4">{username}</h2>
            <p className="text-gray-600 text-sm leading-relaxed px-4">
              This page requires further authentication. You have to first provide the right credential before accessing this page.
            </p>
          </div>

          <div className="space-y-4">
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="password"
                placeholder="Enter your credential"
                value={credential}
                onChange={(e) => {
                  setCredential(e.target.value);
                  if (unlockError) setUnlockError("");
                }}
                className="pl-10 h-12 border-gray-300"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    void handleUnlock();
                  }
                }}
              />
            </div>

            {unlockError && (
              <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
                {unlockError}
              </div>
            )}

            <Button
              onClick={() => void handleUnlock()}
              disabled={unlocking}
              className="w-full bg-red-500 hover:bg-red-600 text-white font-semibold h-12 shadow-md"
            >
              <LockOpen className="w-4 h-4 mr-2" />
              {unlocking ? "Verifying…" : "Unlock"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Phase 2: Statistics Dashboard
  return (
    <div className="w-full max-w-7xl mx-auto">
      {dashboardError && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
          {dashboardError}
        </div>
      )}
      {/* Filter Section */}
      <div className="bg-gray-100 p-4 mb-6 rounded-lg flex items-center gap-4 flex-wrap">
        <div className="relative">
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            placeholder="Select date"
            className="h-10 pr-10 bg-white border-gray-300 w-48"
          />
          <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>

        <div className="relative">
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            placeholder="Select date"
            className="h-10 pr-10 bg-white border-gray-300 w-48"
          />
          <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="show-mine"
            checked={showMine}
            onCheckedChange={(checked) => setShowMine(checked as boolean)}
          />
          <label htmlFor="show-mine" className="text-sm text-gray-700 cursor-pointer">
            Show Mine
          </label>
        </div>

        <Button
          onClick={handleFilter}
          className="bg-red-500 hover:bg-red-600 text-white h-10 px-6"
        >
          Filter
        </Button>

        <Button
          onClick={handlePrint}
          className="bg-blue-600 hover:bg-blue-700 text-white h-10 px-6"
        >
          Print
        </Button>
      </div>

      {/* Statistics Grid */}
      <div className="grid grid-cols-2 gap-6">
        <StatCard
          title="Total Sold"
          value={`${stats?.totals.total_sold_count ?? 0} tickets`}
          icon="hash"
        />
        <StatCard
          title="Total Price"
          value={`${(stats?.totals.total_sold_amount ?? 0).toFixed(2)} ETB`}
          icon="currency"
        />
        <StatCard
          title="Total Jackpots Sold"
          value={`${stats?.totals.total_jackpots_sold_count ?? 0} jackpots`}
          icon="hash"
        />
        <StatCard
          title="Sold Jackpots Price"
          value={`${(stats?.totals.total_jackpots_sold_amount ?? 0).toFixed(2)} ETB`}
          icon="currency"
        />
        <StatCard
          title="Total Deposit Amount"
          value={`${(stats?.totals.total_deposit_amount ?? 0).toFixed(2)} ETB`}
          icon="currency"
        />
        <StatCard
          title="Total Withdraw Amount"
          value={`${(stats?.totals.total_withdraw_amount ?? 0).toFixed(2)} ETB`}
          icon="currency"
        />
        <StatCard
          title="Total Paid Tickets"
          value={`${stats?.totals.total_paid_tickets_count ?? 0} tickets`}
          icon="hash"
        />
        <StatCard
          title="Total Paid Amount"
          value={`${(stats?.totals.total_paid_amount ?? 0).toFixed(2)} ETB`}
          icon="currency"
        />
        <StatCard
          title="Total Paid Jackpots"
          value={`${stats?.totals.total_paid_jackpots_count ?? 0} jackpots`}
          icon="hash"
        />
        <StatCard
          title="Total Paid Jackpot Amount"
          value={`${(stats?.totals.total_paid_jackpots_amount ?? 0).toFixed(2)} ETB`}
          icon="currency"
        />
        <div className="col-span-2">
          <StatCard
            title="Grand Net"
            value={`${(stats?.totals.grand_net ?? 0).toFixed(2)} ETB`}
            icon="currency"
          />
        </div>
      </div>

      {/* Two-Day Payable Report Section */}
      <div className="mt-8">
        <h2 className="text-2xl font-semibold text-gray-700 mb-6">
          Two-Day Payable Report
        </h2>
        <div className="grid grid-cols-2 gap-6">
          <StatCard
            title="Bets"
            value={`${stats?.two_day_payable.bets_count ?? 0} tickets`}
            icon="hash"
          />
          <StatCard
            title="Payable Amount"
            value={`${(stats?.two_day_payable.payable_amount ?? 0).toFixed(2)} ETB`}
            icon="currency"
          />
        </div>
      </div>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon
}: {
  title: string;
  value: string;
  icon: "hash" | "currency";
}) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
      <h3 className="text-base font-semibold text-gray-800 mb-4">{title}</h3>
      <div className="flex items-center gap-2 text-gray-700">
        {icon === "hash" && <Hash className="w-5 h-5 text-gray-600" />}
        {icon === "currency" && <DollarSign className="w-5 h-5 text-gray-600" />}
        <span className="text-lg">{value}</span>
      </div>
    </div>
  );
}

function LoginPage({ onLogin }: { onLogin: (session: CashierSession) => void }) {
  const [sessionExpired, setSessionExpired] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("session_expired") !== "true") return;

    setSessionExpired(true);
    params.delete("session_expired");
    const nextQuery = params.toString();
    const nextUrl = `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", nextUrl);
  }, []);

  const handleLogin = async () => {
    if (loading) return;
    setError("");
    if (!branchId.trim() || !username.trim() || !password) {
      setError("Branch ID, Username, and Password are required.");
      return;
    }

    setLoading(true);
    try {
      const session = await loginCashier({
        branchId: branchId.trim(),
        username,
        password,
      });
      onLogin(session);
    } catch (err) {
      setError((err as Error)?.message ?? "Login failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl border border-gray-200 p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <img
              src="/1birr-icon.svg"
              alt="1birr.bet"
              width={48}
              height={48}
              className="rounded-md"
            />
            <div className="bg-gray-800 text-white px-6 py-3 rounded-md font-bold text-2xl tracking-tight">
              1BIRR<span className="text-green-500">.BET</span>
            </div>
          </div>
          <h2 className="text-xl font-semibold text-gray-800 mt-4">Cashier Login</h2>
          <p className="text-sm text-gray-600 mt-2">Enter your credentials to access the system</p>
        </div>

        <div className="space-y-4">
          {sessionExpired && (
            <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded text-sm">
              Your session expired. Please log in again.
            </div>
          )}
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Branch ID"
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="pl-10 h-12 border-gray-300"
            />
          </div>

          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="text"
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="pl-10 h-12 border-gray-300"
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void handleLogin()}
              className="pl-10 h-12 border-gray-300"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
              {error}
            </div>
          )}

          <Button
            onClick={() => void handleLogin()}
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-12 shadow-md mt-2"
          >
            {loading ? "Logging in..." : "Login"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SettingsPage() {
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [openingBalance, setOpeningBalance] = useState("0");
  const [closingBalance, setClosingBalance] = useState("0");
  const [shiftMsg, setShiftMsg] = useState("");
  const [pwMsg, setPwMsg] = useState("");

  const [pwBusy, setPwBusy] = useState(false);

  const handleChangePassword = async () => {
    if (pwBusy) return;
    setPwMsg("");
    if (!oldPassword || !newPassword || !confirmPassword) {
      setPwMsg("Please fill all password fields.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwMsg("New password and confirm password do not match.");
      return;
    }
    if (newPassword.length < 8) {
      setPwMsg("New password must be at least 8 characters long.");
      return;
    }
    setPwBusy(true);
    try {
      await changeCashierPassword({
        current_password: oldPassword,
        new_password: newPassword,
      });
      setPwMsg("Password changed. All other sessions have been signed out.");
      setOldPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      setPwMsg((err as Error).message || "Failed to change password.");
    } finally {
      setPwBusy(false);
    }
  };

  const handleOpenShift = async () => {
    try {
      await openShift({ opening_balance: openingBalance || "0" });
      setShiftMsg("Shift opened successfully.");
    } catch (err) {
      setShiftMsg((err as Error).message || "Failed to open shift.");
    }
  };

  const handleCloseShift = async () => {
    try {
      await closeShift({ closing_balance: closingBalance || "0" });
      setShiftMsg("Shift closed successfully.");
    } catch (err) {
      setShiftMsg((err as Error).message || "Failed to close shift.");
    }
  };

  return (
    <div className="w-full max-w-2xl">
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <h2 className="text-xl font-semibold text-gray-800 mb-6">Change Your Password</h2>
        {pwMsg && (
          <div className="mb-4 text-sm px-3 py-2 rounded bg-blue-50 border border-blue-200 text-blue-700">
            {pwMsg}
          </div>
        )}

        <div className="space-y-4">
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="password"
              placeholder="Old Password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className="pl-10 h-12 border-gray-300"
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="password"
              placeholder="New Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="pl-10 h-12 border-gray-300"
            />
          </div>

          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              type="password"
              placeholder="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="pl-10 h-12 border-gray-300"
            />
          </div>

          <Button
            onClick={() => void handleChangePassword()}
            disabled={pwBusy}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold h-12 shadow-md mt-2"
          >
            {pwBusy ? "Changing…" : "Change Password"}
          </Button>
        </div>

        <div className="mt-8 border-t pt-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">Shift Operations</h3>
          {shiftMsg && (
            <div className="mb-4 text-sm px-3 py-2 rounded bg-green-50 border border-green-200 text-green-700">
              {shiftMsg}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              type="number"
              placeholder="Opening balance"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              className="h-11 border-gray-300"
            />
            <Button onClick={() => void handleOpenShift()} className="h-11 bg-green-600 hover:bg-green-700 text-white">
              Open Shift
            </Button>
            <Input
              type="number"
              placeholder="Closing balance"
              value={closingBalance}
              onChange={(e) => setClosingBalance(e.target.value)}
              className="h-11 border-gray-300"
            />
            <Button onClick={() => void handleCloseShift()} className="h-11 bg-red-600 hover:bg-red-700 text-white">
              Close Shift
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
