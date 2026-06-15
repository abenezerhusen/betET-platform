/**
 * Deposit wagering rule — "deposited funds must be wagered before they
 * can be withdrawn; only winnings generated from played deposits can be
 * withdrawn".
 *
 * The status is derived from the append-only `transactions` ledger, so
 * no deposit / bet code path needs to bookkeep extra columns:
 *
 *   total_deposited     = Σ completed deposit credits
 *   total_wagered       = Σ bet stakes − Σ bet refunds
 *   wagering_remaining  = max(0, total_deposited − total_wagered)
 *   withdrawable        = max(0, balance − wagering_remaining)
 *
 * Every user-facing withdrawal path calls `assertWithdrawalAllowed()`
 * before debiting/locking funds.
 */

import type { PoolClient } from 'pg';
import { BadRequestError } from '../http/errors/http-error';

/** Ledger types that count as a cash deposit subject to wagering. */
const DEPOSIT_TYPES = ['deposit', 'cashier_deposit', 'p2p_deposit'];
/** Ledger statuses that invalidate a row for the calculation. */
const VOID_STATUSES = ['failed', 'reversed', 'cancelled'];

export interface DepositWageringStatus {
  /** Lifetime completed deposits into this wallet. */
  total_deposited: number;
  /** Lifetime stake turnover (bets placed minus refunded stakes). */
  total_wagered: number;
  /** Deposited amount that still has to be wagered. */
  wagering_remaining: number;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getDepositWageringStatus(
  client: PoolClient,
  walletId: string
): Promise<DepositWageringStatus> {
  const r = await client.query<{
    total_deposited: string;
    total_wagered: string;
  }>(
    `SELECT
        COALESCE(SUM(CASE WHEN type = ANY($2::text[]) AND status = 'completed'
                          THEN amount ELSE 0 END), 0)::text AS total_deposited,
        COALESCE(SUM(CASE WHEN type = 'bet_stake' AND NOT (status = ANY($3::text[]))
                          THEN -amount
                          WHEN type = 'bet_refund' AND NOT (status = ANY($3::text[]))
                          THEN -amount
                          ELSE 0 END), 0)::text AS total_wagered
       FROM transactions
      WHERE wallet_id = $1`,
    [walletId, DEPOSIT_TYPES, VOID_STATUSES]
  );
  const totalDeposited = round2(Math.max(0, Number(r.rows[0]?.total_deposited ?? 0)));
  const totalWagered = round2(Math.max(0, Number(r.rows[0]?.total_wagered ?? 0)));
  return {
    total_deposited: totalDeposited,
    total_wagered: totalWagered,
    wagering_remaining: round2(Math.max(0, totalDeposited - totalWagered)),
  };
}

/** Portion of `balance` that can be withdrawn right now. */
export function withdrawableAmount(
  balance: number,
  status: DepositWageringStatus
): number {
  return round2(Math.max(0, balance - status.wagering_remaining));
}

/**
 * Throws when `amount` exceeds the withdrawable portion of the wallet.
 * Call inside the same transaction that performs the debit, after the
 * wallet row has been read (ideally FOR UPDATE).
 */
export async function assertWithdrawalAllowed(
  client: PoolClient,
  walletId: string,
  balance: number,
  amount: number
): Promise<void> {
  const status = await getDepositWageringStatus(client, walletId);
  const withdrawable = withdrawableAmount(balance, status);
  if (amount > withdrawable + 0.0001) {
    throw new BadRequestError(
      `Deposited funds must be wagered before withdrawal. Withdrawable: ${withdrawable.toFixed(2)} (still to wager: ${status.wagering_remaining.toFixed(2)})`,
      {
        reason: 'wagering_requirement_not_met',
        withdrawable,
        wagering_remaining: status.wagering_remaining,
        total_deposited: status.total_deposited,
        total_wagered: status.total_wagered,
        requested: amount,
      }
    );
  }
}
