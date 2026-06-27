const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

const DEFAULT_TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID ?? "default";

const SESSION_KEY = "playcore-cashier-session";
let sessionExpiredRedirecting = false;

export interface CashierUser {
  id: string;
  tenant_id: string;
  role: string;
  email: string | null;
  phone: string | null;
  /**
   * Section 22 permissions resolved at login. Contains the wildcard
   * sentinel "*" for super admins; otherwise the explicit catalog of
   * permission IDs the admin granted (e.g. "sell_tickets", "can_payout",
   * "cancel_tickets", "deposit", "withdraw"). The cashier panel gates
   * every action button on this list.
   */
  permissions?: string[];
}

export interface CashierBranch {
  id: string;
  user_id: string;
  branch_code: string | null;
  label: string | null;
}

export interface CashierSession {
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string;
  refresh_token_expires_at: string;
  user: CashierUser;
  branch?: CashierBranch | null;
  tenant_id: string;
  login_username?: string;
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

function getStoredSession(): CashierSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CashierSession;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function saveCashierSession(session: CashierSession) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function getCashierSession() {
  return getStoredSession();
}

export function clearCashierSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

/**
 * Section 22 — Permission gate for the cashier panel.
 *
 * Reads the permission list stamped on the current session at login
 * time. The backend resolves permissions from `users.metadata.permissions`
 * (per-user override saved by the admin via the Role Settings modal)
 * with fallback to the `roles` table.
 *
 * The wildcard "*" always grants access (super admins). Missing or
 * empty session returns false — the cashier must re-login.
 */
export function hasCashierPermission(permission: string): boolean {
  const session = getStoredSession();
  const perms = session?.user.permissions;
  if (!perms || perms.length === 0) return false;
  if (perms.includes('*')) return true;
  return perms.includes(permission);
}

/**
 * The exact spec-mandated message shown when a cashier attempts an action
 * they have not been granted permission for.
 */
export const PERMISSION_DENIED_MESSAGE =
  "You do not have permission to perform this action. Please contact the administrator.";

type PermissionDeniedListener = (message: string) => void;
let permissionDeniedListener: PermissionDeniedListener | null = null;

/**
 * Register a single global listener (the app shell) that renders the
 * permission-denied popup. Returns an unsubscribe function.
 */
export function onPermissionDenied(cb: PermissionDeniedListener): () => void {
  permissionDeniedListener = cb;
  return () => {
    if (permissionDeniedListener === cb) permissionDeniedListener = null;
  };
}

function triggerPermissionDenied(message: string = PERMISSION_DENIED_MESSAGE): void {
  if (permissionDeniedListener) permissionDeniedListener(message);
}

/**
 * Permission gate for action handlers. If the current cashier lacks
 * `permission`, the spec-mandated popup is shown and the function returns
 * false so the caller can short-circuit (the action "must not execute").
 * Returns true when the action may proceed.
 */
export function ensureCashierPermission(permission: string): boolean {
  if (hasCashierPermission(permission)) return true;
  triggerPermissionDenied();
  return false;
}

/** Re-verifies the currently logged in user's password against the
 * backend without issuing a new token. Used by the Dashboard "unlock"
 * step-up screen. Returns true iff the password matches. */
export async function verifyMyPassword(password: string): Promise<boolean> {
  try {
    const out = await apiRequest<{ valid: boolean }>("/api/auth/verify-password", {
      method: "POST",
      body: JSON.stringify({ password }),
      headers: { "content-type": "application/json" },
      auth: true,
    });
    return Boolean(out?.valid);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return false;
    throw err;
  }
}

function redirectToSessionExpired(): void {
  if (typeof window === "undefined" || sessionExpiredRedirecting) return;
  sessionExpiredRedirecting = true;
  clearCashierSession();
  window.location.href = "/?session_expired=true";
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFromBody(body: unknown, fallback: string): string {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    if (typeof record.message === "string") return record.message;
    if (typeof record.error === "string") return record.error;
  }
  return fallback;
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit & {
    tenantId?: string;
    auth?: boolean;
    query?: Record<string, string | number | boolean | undefined>;
  } = {}
): Promise<T> {
  const session = getStoredSession();
  const tenantId = options.tenantId ?? session?.tenant_id ?? DEFAULT_TENANT_ID;
  const headers = new Headers(options.headers);

  headers.set("accept", "application/json");
  headers.set("x-tenant-id", tenantId);
  if (options.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  if (options.auth !== false && session?.access_token) {
    headers.set("authorization", `Bearer ${session.access_token}`);
  }

  const qs = new URLSearchParams();
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v === undefined || v === null || v === "") continue;
      qs.set(k, String(v));
    }
  }
  const querySuffix = qs.toString() ? `?${qs.toString()}` : "";
  const target = `${API_BASE_URL}${path.startsWith("/") ? path : `/${path}`}${querySuffix}`;

  const { query: _query, ...fetchOptions } = options;

  const res = await fetch(target, {
    ...fetchOptions,
    headers,
  });
  const body = await parseBody(res);
  const shouldHandleAsSessionExpiry =
    res.status === 401 &&
    options.auth !== false &&
    Boolean(session?.access_token);
  if (shouldHandleAsSessionExpiry) {
    redirectToSessionExpired();
    throw new ApiError(401, "Session expired", body);
  }
  if (!res.ok) {
    // Backend permission failures (requirePermission gate) and cross-
    // branch ticket-access denials both surface as 403. Mirror them to
    // the global popup so a denied action always shows the spec-mandated
    // message, even if the client-side gate was somehow bypassed. We
    // pass the backend's specific message (e.g. "This ticket belongs to
    // another branch…") so the popup is actionable rather than generic.
    if (res.status === 403) {
      const backendMessage = messageFromBody(body, "");
      triggerPermissionDenied(backendMessage || PERMISSION_DENIED_MESSAGE);
    }
    throw new ApiError(res.status, messageFromBody(body, `Request failed (${res.status})`), body);
  }
  return body as T;
}

export async function loginCashier(params: {
  tenantId?: string;
  branchId: string;
  username: string;
  password: string;
}): Promise<CashierSession> {
  const branchId = params.branchId.trim();
  const identifier = params.username.trim();
  if (!branchId) {
    throw new ApiError(400, "Branch ID is required.", null);
  }
  if (!identifier) {
    throw new ApiError(400, "Username is required.", null);
  }

  const payload = identifier.includes("@")
    ? { email: identifier, password: params.password, branch_id: branchId }
    : { username: identifier, password: params.password, branch_id: branchId };
  const tenant_id = params.tenantId?.trim() || DEFAULT_TENANT_ID;

  // Section 16 — dedicated cashier login endpoint. Role-gated server-side
  // (only `cashier`/`sales` get tokens) and returns `branch` alongside the
  // token so the panel can display the branch label without a second
  // round-trip.
  const session = await apiRequest<CashierSession>("/api/auth/cashier/login", {
    method: "POST",
    body: JSON.stringify(payload),
    tenantId: tenant_id,
    auth: false,
  });

  if (!["cashier", "sales"].includes(session.user.role)) {
    throw new ApiError(403, "This account is not allowed to access the cashier panel.", session);
  }

  const withTenant = { ...session, tenant_id };
  withTenant.login_username = identifier;
  saveCashierSession(withTenant);
  return withTenant;
}

export async function changeCashierPassword(input: {
  current_password: string;
  new_password: string;
}): Promise<{ success: boolean }> {
  return apiRequest("/api/auth/cashier/password", {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export interface CashierUserSummary {
  id: string;
  tenant_id: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: string;
  kyc_status: string;
  metadata?: Record<string, unknown>;
}

export interface CashierWalletRow {
  id: string;
  tenant_id: string;
  user_id: string;
  currency: string;
  balance: string;
  bonus_balance: string;
  locked_balance: string;
  status: string;
}

export interface CashierTransactionRow {
  id: string;
  tenant_id: string;
  cashier_id: string;
  user_id: string | null;
  shift_id: string | null;
  branch_id: string | null;
  type: "deposit" | "withdrawal" | string;
  amount: string;
  currency: string;
  status: string;
  reference: string | null;
  notes: string | null;
  metadata?: Record<string, unknown>;
  created_at: string;
  completed_at: string | null;
}

export interface ShiftSummary {
  opening_balance: string;
  total_deposits: string;
  total_withdrawals: string;
  deposit_count: number;
  withdrawal_count: number;
  expected_balance: string;
  duration_seconds: number;
  closing_balance?: string | null;
  variance?: string | null;
}

export interface CashierShift {
  id: string;
  tenant_id: string;
  cashier_id: string;
  branch_id: string | null;
  status: string;
  opening_balance: string;
  closing_balance: string | null;
  expected_balance: string | null;
  variance: string | null;
  currency: string;
  opened_at: string;
  closed_at: string | null;
}

export async function searchCashierUsers(input: {
  query?: string;
  phone?: string;
  email?: string;
  user_id?: string;
  limit?: number;
}): Promise<{ items: CashierUserSummary[]; count: number }> {
  return apiRequest("/api/cashier/users/search", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface CashierCouponLookup {
  coupon_code: string;
  bet_id: string;
  status: string;
  stake: string;
  potential_win: string;
  payout: string | null;
  currency: string;
  game_id: string | null;
  placed_at: string;
  settled_at: string | null;
  selection: unknown;
  user: CashierUserSummary;
  transaction_reference: string | null;
}

export async function lookupCashierCoupon(code: string): Promise<CashierCouponLookup> {
  const trimmed = code.trim();
  return apiRequest(`/api/cashier/users/coupon/${encodeURIComponent(trimmed)}`);
}

export async function getCashierUserWallet(
  userId: string,
  query: { currency?: string; page?: number; limit?: number } = {}
): Promise<{
  user: CashierUserSummary;
  wallet: CashierWalletRow | null;
  transactions: {
    items: Array<Record<string, unknown>>;
    total: number;
    page: number;
    limit: number;
    pages: number;
  };
}> {
  return apiRequest(`/api/cashier/users/${userId}/wallet`, {
    query: query as Record<string, string | number | undefined>,
  });
}

export interface CashierDepositInput {
  /**
   * The legacy callers pass `user_id` after a user-search. Section 16
   * Deposit screen passes `phone` directly — both work.
   */
  user_id?: string;
  phone?: string;
  email?: string;
  branch_id?: string;
  amount: string | number;
  currency?: string;
  payment_method?: "cash" | "card" | "bank_transfer" | "mobile_money" | "voucher" | "other";
  reference?: string;
  notes?: string;
  idempotency_key?: string;
}

export async function cashierDeposit(input: CashierDepositInput) {
  return apiRequest("/api/cashier/deposit", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function cashierWithdrawal(input: CashierDepositInput) {
  return apiRequest("/api/cashier/withdrawal", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listCashierTransactions(query: {
  page?: number;
  limit?: number;
  type?: "deposit" | "withdrawal";
  status?: "pending" | "approved" | "rejected" | "completed" | "cancelled" | "failed";
  shift_id?: string;
  from?: string;
  to?: string;
} = {}): Promise<{
  items: CashierTransactionRow[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}> {
  return apiRequest("/api/cashier/transactions", {
    query: query as Record<string, string | number | undefined>,
  });
}

export async function getCurrentShift(): Promise<{
  shift: CashierShift | null;
  summary: ShiftSummary | null;
}> {
  return apiRequest("/api/cashier/shift/current");
}

export async function openShift(input: {
  opening_balance: string | number;
  branch_id?: string;
  currency?: string;
  notes?: string;
}) {
  return apiRequest("/api/cashier/shift/open", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function closeShift(input: {
  closing_balance: string | number;
  notes?: string;
}) {
  return apiRequest("/api/cashier/shift/close", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export interface CashierReceiptItem {
  description: string;
  amount: string;
}

export interface CashierReceipt {
  receipt_id: string;
  branch_id: string;
  cashier_name: string;
  ticket_type: "bet" | "payout" | "deposit" | "withdrawal" | string;
  items: CashierReceiptItem[];
  total: string;
  currency: string;
  timestamp: string;
  barcode_data: string;
  qr_data: string;
  meta?: {
    user_username?: string | null;
    user_full_name?: string | null;
    bet_by?: string | null;
    user_phone?: string | null;
    user_email?: string | null;
    notes?: string | null;
    reference?: string | null;
    status?: string;
  };
}

export async function getCashierReceipt(ticketId: string): Promise<CashierReceipt> {
  return apiRequest(`/api/cashier/transactions/${encodeURIComponent(ticketId)}/receipt`);
}

/* ===================================================================== */
/* Section 16 — Tickets                                                  */
/* ===================================================================== */

export type CashierTicketStatus =
  | "pending"
  | "won"
  | "cashback"
  | "lost"
  | "void"
  | "expired"
  | "already_paid";

export interface CashierTicket {
  ticket_id: string;
  /**
   * Auto-generated TKT-XXXXXXXX code (always present, derived from
   * the underlying bet UUID by the database).
   */
  ticket_code?: string;
  /** Printed receipt code (TKT-{BRANCH}-{YYYYMMDD}-{SEQ}); null until sold. */
  printed_ticket_code?: string | null;
  /**
   * Sportsbook user-panel coupon code (SBK-XXXXXXXX). Populated only
   * when the ticket originated as a sportsbook slip; null for casino
   * and internal-game tickets.
   */
  coupon_code?: string | null;
  /**
   * Which underlying table the ticket lives in. Useful for the UI to
   * surface "Sports slip" vs "Game ticket" badges, but optional so
   * older deployments without this field keep working.
   */
  source?: "bets" | "sportsbook_bets";
  bet_id: string;
  user_id: string;
  user_phone: string | null;
  user_email: string | null;
  stake: number;
  potential_win: number;
  currency: string;
  status: CashierTicketStatus;
  raw_status: string;
  payout_amount: number;
  cashback_amount: number;
  issued_at: string;
  expires_at: string;
  expired: boolean;
  expiry_days: number;
  sold_at: string | null;
  sold_by_cashier_id: string | null;
  sold_branch_id: string | null;
  paid_at: string | null;
  paid_by_cashier_id: string | null;
  paid_branch_id: string | null;
  selections: unknown[];
  metadata: Record<string, unknown>;
  placed_at: string;
}

export interface CashierTicketCheck {
  ticket_id: string;
  bet_id: string;
  status: CashierTicketStatus;
  payout_amount: number;
  cashback_amount: number;
  stake: number;
  issued_at: string;
  expires_at: string;
  expired: boolean;
  expiry_days: number;
  raw_status: string;
  currency: string;
  paid_at: string | null;
}

export async function lookupCashierTicket(ticketId: string): Promise<CashierTicket> {
  return apiRequest(
    `/api/cashier/tickets/${encodeURIComponent(ticketId.trim())}`,
  );
}

export async function checkCashierTicketPayout(
  ticketId: string,
): Promise<CashierTicketCheck> {
  return apiRequest(
    `/api/cashier/tickets/${encodeURIComponent(ticketId.trim())}/check-payout`,
  );
}

export async function sellCashierTicket(
  ticketId: string,
): Promise<{ already_sold: boolean; ticket: CashierTicket }> {
  return apiRequest(
    `/api/cashier/tickets/${encodeURIComponent(ticketId.trim())}/sell`,
    { method: "POST" },
  );
}

export async function payoutCashierTicket(
  ticketId: string,
): Promise<{ ticket: CashierTicket; paid_amount: number; currency: string }> {
  return apiRequest(
    `/api/cashier/tickets/${encodeURIComponent(ticketId.trim())}/payout`,
    { method: "POST" },
  );
}

export async function cancelCashierTicket(
  ticketId: string,
): Promise<{ ticket: CashierTicket; refunded: number; currency: string }> {
  return apiRequest(
    `/api/cashier/tickets/${encodeURIComponent(ticketId.trim())}/cancel`,
    { method: "POST" },
  );
}

export async function removeCashierTicketLeg(
  ticketId: string,
  index: number,
): Promise<{ ticket: CashierTicket; removed_match: string }> {
  return apiRequest(
    `/api/cashier/tickets/${encodeURIComponent(ticketId.trim())}/remove-leg`,
    { method: "POST", body: JSON.stringify({ index }) },
  );
}

export async function listCashierTickets(query: {
  date?: "today" | "yesterday";
  mine?: boolean;
  status?: string;
  page?: number;
  limit?: number;
} = {}): Promise<{
  items: CashierTicket[];
  total: number;
  page: number;
  limit: number;
  expiry_days: number;
}> {
  return apiRequest("/api/cashier/tickets", {
    query: query as Record<string, string | number | boolean | undefined>,
  });
}

/* ===================================================================== */
/* Section 16 — Super Jackpots                                           */
/* ===================================================================== */

export interface CashierJackpot {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  entry_fee: string;
  prize_pool: string;
  currency: string;
  max_entries: number | null;
  rules: Record<string, unknown>;
  created_at: string;
  tickets_sold?: string;
}

export interface CashierJackpotTicket {
  id: string;
  cashier_id: string;
  jackpot_id: string;
  channel: string;
  stake: string;
  currency: string;
  potential_payout: string;
  status: string;
  placed_at: string;
  ticket_code: string;
  jackpot_name: string | null;
  metadata?: Record<string, unknown>;
}

export async function listActiveJackpots(): Promise<{
  items: CashierJackpot[];
}> {
  return apiRequest("/api/cashier/jackpots/active");
}

export async function listJackpotTicketsToday(
  mine = true,
): Promise<{ items: CashierJackpotTicket[] }> {
  return apiRequest("/api/cashier/jackpots/today", {
    query: { mine },
  });
}

export async function sellJackpotTicket(
  jackpotId: string,
  input: {
    quantity?: number;
    stake?: string | number;
    player_phone?: string;
    selections?: Array<Record<string, unknown>>;
  } = {},
): Promise<{
  jackpot_id: string;
  jackpot_name: string;
  currency: string;
  quantity: number;
  total_stake: number;
  tickets: Array<{ id: string; ticket_code: string; stake: string; currency: string }>;
}> {
  return apiRequest(
    `/api/cashier/jackpots/${encodeURIComponent(jackpotId)}/sell`,
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

/* ===================================================================== */
/* Section 16 — Branch Withdrawal                                        */
/* ===================================================================== */

export interface CashierPendingWithdrawal {
  id: string;
  code: string;
  status: string;
  amount: number;
  currency: string;
  user_id?: string;
  user_phone?: string | null;
  user_email?: string | null;
  user_full_name?: string | null;
  expires_at: string;
  created_at?: string;
  processed_at?: string | null;
}

export async function findPendingBranchWithdrawal(
  code: string,
): Promise<CashierPendingWithdrawal> {
  return apiRequest("/api/cashier/withdrawal/pending", {
    query: { code: code.trim() },
  });
}

export async function processBranchWithdrawal(
  id: string,
): Promise<CashierPendingWithdrawal> {
  return apiRequest(
    `/api/cashier/withdrawal/${encodeURIComponent(id)}/process`,
    { method: "POST" },
  );
}

/* ===================================================================== */
/* Section 16 — Dashboard                                                */
/* ===================================================================== */

export interface CashierDashboardStats {
  from: string;
  to: string;
  mine: boolean;
  totals: {
    total_sold_count: number;
    total_sold_amount: number;
    total_jackpots_sold_count: number;
    total_jackpots_sold_amount: number;
    total_paid_tickets_count: number;
    total_paid_amount: number;
    total_paid_jackpots_count: number;
    total_paid_jackpots_amount: number;
    total_deposit_count: number;
    total_deposit_amount: number;
    total_withdraw_count: number;
    total_withdraw_amount: number;
    grand_net: number;
  };
  two_day_payable: {
    bets_count: number;
    payable_amount: number;
    since: string;
  };
}

export async function getCashierDashboardStats(query: {
  from?: string;
  to?: string;
  mine?: boolean;
} = {}): Promise<CashierDashboardStats> {
  return apiRequest("/api/cashier/dashboard/stats", {
    query: query as Record<string, string | number | boolean | undefined>,
  });
}
