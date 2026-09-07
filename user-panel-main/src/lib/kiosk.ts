/**
 * Kiosk (walk-in) attribution context.
 *
 * When a cashier uses "Launch Fixtures" on the cashier panel, it opens this
 * user panel in a new tab with the operating cashier + branch identity in the
 * URL query string (e.g. ?kiosk_cashier_id=…&kiosk_branch_id=…). We capture
 * those once on first load and persist them for the tab's lifetime so the
 * offline (branch-pay) reservation can attribute the walk-in slip to the
 * branch/cashier that created it. The backend re-validates the ids before
 * trusting them, so this is purely a hint — never a source of truth.
 *
 * Nothing here runs for a normal online player: without the kiosk_* params the
 * context is empty and the reservation body carries no attribution, exactly as
 * before.
 */

const KEY = 'playcore-kiosk-ctx';

export interface KioskContext {
  cashier_id?: string;
  branch_id?: string;
  cashier_name?: string;
  branch_label?: string;
}

/**
 * Read the kiosk_* params off the current URL (if any) and persist them to
 * sessionStorage. Safe to call on every mount — it only writes when at least
 * one kiosk param is present, so it never clobbers an existing context on
 * client-side navigations that dropped the query string.
 */
export function captureKioskContextFromUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const p = new URLSearchParams(window.location.search);
    const ctx: KioskContext = {};
    const cashierId = p.get('kiosk_cashier_id');
    const branchId = p.get('kiosk_branch_id');
    const cashierName = p.get('kiosk_cashier_name');
    const branchLabel = p.get('kiosk_branch_label');
    if (cashierId) ctx.cashier_id = cashierId;
    if (branchId) ctx.branch_id = branchId;
    if (cashierName) ctx.cashier_name = cashierName;
    if (branchLabel) ctx.branch_label = branchLabel;
    if (Object.keys(ctx).length > 0) {
      window.sessionStorage.setItem(KEY, JSON.stringify(ctx));
    }
  } catch {
    /* sessionStorage / URL parsing unavailable — ignore, stay unattributed. */
  }
}

/** Current kiosk context for this tab (empty object when not a kiosk). */
export function getKioskContext(): KioskContext {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as KioskContext) : {};
  } catch {
    return {};
  }
}
