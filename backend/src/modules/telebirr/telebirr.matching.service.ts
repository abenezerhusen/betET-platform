import type { PoolClient } from 'pg';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import { tryAudit } from '../audit/audit.service';
import { emitWalletUpdated } from '../../realtime/socket';

import * as repo from './telebirr.repository';
import {
  emitDepositConfirmed,
  emitDepositSuccessful,
  emitNewDeposit,
} from './telebirr.events';
import {
  auditFraudSignal,
  checkAgentDailyVolumeCap,
  checkAmountCeiling,
  checkSenderPhoneVelocity,
  suspendAgentForFraud,
} from './telebirr.fraud';
import { loadTelebirrSettings } from './telebirr.settings';
import type { ParsedSms } from './telebirr.parser';
import { runPostDepositPromotions } from '../promotions/deposit-hooks';

/* ------------------------------------------------------------------------- */
/* Public types                                                              */
/* ------------------------------------------------------------------------- */

export type MatchOutcome =
  | 'credited'
  | 'duplicate'
  | 'unmatched'
  | 'probable_match'
  | 'ambiguous'
  | 'skipped';

export interface MatchPaymentContext {
  /** Telebirr agent (device) that uploaded the SMS. */
  agentId: string;
  /** Active tenant (resolved from agent.tenant_id by the caller). */
  tenantId: string;
  /** Row in telebirr_sms_raw to mark processed=true on success. */
  smsRawId: string;
}

export interface MatchPaymentResult {
  outcome: MatchOutcome;
  reason: string;
  /** The telebirr_transactions row created (or found, on duplicate). */
  telebirrTransactionId: string | null;
  /** Wallet ledger transaction id when a credit occurred. */
  creditTransactionId: string | null;
  /** Deposit request that resolved the match (if any). */
  depositRequestId: string | null;
  matchedUserId: string | null;
  strategy:
    | 'claimed_ref'
    | 'reference_code'
    | 'amount_phone'
    | 'amount_window'
    | 'none'
    | null;
}

/* ------------------------------------------------------------------------- */
/* Constants                                                                 */
/* ------------------------------------------------------------------------- */

/** Strategy 3 lookback window in minutes. */
const AMOUNT_WINDOW_MINUTES = 30;

/** PostgreSQL unique-violation SQLSTATE. */
const UNIQUE_VIOLATION = '23505';

/* ------------------------------------------------------------------------- */
/* matchPayment — entry point                                                */
/* ------------------------------------------------------------------------- */

/**
 * Match a parsed Telebirr SMS to a user wallet and credit them.
 *
 * Idempotency: the unique constraint on `telebirr_transactions.telebirr_ref`
 * is the system's last line of defence — even concurrent processors that
 * pick up the same SMS twice end up with one credited row and one
 * `duplicate` outcome.
 *
 * Side effects on a successful credit (executed AFTER the DB transaction
 * commits, never before):
 *   1. Best-effort audit log.
 *   2. Socket emit DEPOSIT_CONFIRMED to the player's room.
 *   3. Socket emit WALLET_UPDATED to the player's room.
 *   4. Socket emit NEW_DEPOSIT to cashier + admin rooms.
 *   5. Socket emit DEPOSIT_SUCCESSFUL (notification channel).
 */
export async function matchPayment(
  parsed: ParsedSms,
  ctx: MatchPaymentContext
): Promise<MatchPaymentResult> {
  // 0. Skip non-financial / non-credit SMS — keep them in sms_raw,
  //    flip processed=true so the worker doesn't pick them up again.
  if (parsed.type !== 'received') {
    await markSmsProcessedSafe(ctx);
    return {
      outcome: 'skipped',
      reason: `non-credit SMS (type=${parsed.type})`,
      telebirrTransactionId: null,
      creditTransactionId: null,
      depositRequestId: null,
      matchedUserId: null,
      strategy: null,
    };
  }

  if (!parsed.amount || parsed.amount <= 0) {
    await markSmsProcessedSafe(ctx);
    return {
      outcome: 'skipped',
      reason: 'received SMS without parseable amount',
      telebirrTransactionId: null,
      creditTransactionId: null,
      depositRequestId: null,
      matchedUserId: null,
      strategy: null,
    };
  }

  if (!parsed.telebirrRef) {
    // Without a Telebirr reference we cannot dedupe — store as unmatched
    // so a cashier can investigate.
    return await persistUnmatched(parsed, ctx, 'no telebirr reference parsed');
  }

  // 1. Fast-path duplicate check (DB unique index is the safety net).
  const dup = await withTenantClient(
    { tenantId: ctx.tenantId },
    async (client) => repo.findTelebirrTxByRef(client, parsed.telebirrRef!)
  );
  if (dup) {
    await markSmsProcessedSafe(ctx);
    return {
      outcome: 'duplicate',
      reason: `telebirr_ref ${parsed.telebirrRef} already on file`,
      telebirrTransactionId: dup.id,
      creditTransactionId: dup.credit_transaction_id,
      depositRequestId: null,
      matchedUserId: dup.user_id,
      strategy: null,
    };
  }

  // 2. Run the strategies inside a single tenant-scoped transaction so
  //    deposit-request locks survive across the whole match decision.
  const decision = await runMatchingStrategies(parsed, ctx);

  // 2a. Fraud guards that can DEMOTE an auto-credit to a manual review.
  //     We only run them when strategies say `matched` — for everything
  //     else the resulting telebirr_transactions row is already in a
  //     non-crediting state, so further demotion is moot. Both rules
  //     need access to the tenant settings + an open client (RULE 6
  //     queries telebirr_transactions), so we open one transaction.
  let effectiveDecision: MatchDecision = decision;
  if (decision.kind === 'matched') {
    const guarded = await applyMatchTimeFraudGuards(parsed, ctx, decision);
    effectiveDecision = guarded;
  }

  switch (effectiveDecision.kind) {
    case 'matched':
      return await creditMatch(parsed, ctx, effectiveDecision);
    case 'probable_match':
      return await persistAmbiguous(parsed, ctx, effectiveDecision, 'probable_match');
    case 'ambiguous':
      return await persistAmbiguous(parsed, ctx, effectiveDecision, 'ambiguous');
    case 'unmatched':
      return await persistUnmatched(parsed, ctx, effectiveDecision.reason);
  }
}

/**
 * RULE 4 (amount ceiling) and RULE 6 (sender phone velocity).
 *
 * If either fires we convert a `matched` decision into a `probable_match`
 * so the credit pipeline doesn't fire and a cashier picks it up from
 * the unmatched queue. We deliberately do NOT downgrade to `ambiguous`
 * (which suggests "multiple users plausible"); the right user is known
 * — we just want a human to authorise the credit.
 */
async function applyMatchTimeFraudGuards(
  parsed: ParsedSms,
  ctx: MatchPaymentContext,
  decision: MatchedDecision
): Promise<MatchDecision> {
  const { settings, velocity } = await withTenantClient(
    { tenantId: ctx.tenantId },
    async (client) => {
      const s = await loadTelebirrSettings(client, ctx.tenantId);
      const v = await checkSenderPhoneVelocity(
        client,
        ctx.tenantId,
        parsed.senderPhone,
        s,
        parsed.telebirrRef
      );
      return { settings: s, velocity: v };
    }
  );

  // RULE 4 — amount ceiling.
  const amountVerdict = checkAmountCeiling(Number(parsed.amount), settings);
  if (amountVerdict.kind === 'escalate') {
    void auditFraudSignal({
      tenantId: ctx.tenantId,
      rule: 'rule4_amount',
      resource: 'telebirr_transaction',
      resourceId: null,
      payload: {
        amount: parsed.amount,
        max_single_sms_amount: settings.max_single_sms_amount,
        telebirr_ref: parsed.telebirrRef,
        sender_phone: parsed.senderPhone,
        original_strategy: decision.strategy,
        original_user_id: decision.userId,
      },
      ip: null,
      userAgent: null,
    });
    return {
      kind: 'probable_match',
      strategy: 'amount_window',
      candidateUserIds: [decision.userId],
      candidateDepositRequestIds: decision.depositRequestId
        ? [decision.depositRequestId]
        : [],
    };
  }

  // RULE 6 — sender phone velocity.
  if (velocity.shouldDemote) {
    void auditFraudSignal({
      tenantId: ctx.tenantId,
      rule: 'rule6_velocity',
      resource: 'telebirr_transaction',
      resourceId: null,
      payload: {
        sender_phone: parsed.senderPhone,
        recent_count: velocity.recentCount,
        threshold: velocity.threshold,
        window_minutes: velocity.windowMinutes,
        telebirr_ref: parsed.telebirrRef,
        original_strategy: decision.strategy,
        original_user_id: decision.userId,
      },
      ip: null,
      userAgent: null,
    });
    return {
      kind: 'probable_match',
      strategy: 'amount_window',
      candidateUserIds: [decision.userId],
      candidateDepositRequestIds: decision.depositRequestId
        ? [decision.depositRequestId]
        : [],
    };
  }

  return decision;
}

/* ------------------------------------------------------------------------- */
/* Strategy resolution                                                       */
/* ------------------------------------------------------------------------- */

interface MatchedDecision {
  kind: 'matched';
  strategy: 'claimed_ref' | 'reference_code' | 'amount_phone' | 'amount_window';
  userId: string;
  depositRequestId: string | null;
}
interface ProbableDecision {
  kind: 'probable_match';
  candidateUserIds: string[];
  candidateDepositRequestIds: string[];
  strategy: 'amount_window';
}
interface AmbiguousDecision {
  kind: 'ambiguous';
  candidateUserIds: string[];
  candidateDepositRequestIds: string[];
  strategy: 'amount_window';
}
interface UnmatchedDecision {
  kind: 'unmatched';
  reason: string;
}

type MatchDecision =
  | MatchedDecision
  | ProbableDecision
  | AmbiguousDecision
  | UnmatchedDecision;

async function runMatchingStrategies(
  parsed: ParsedSms,
  ctx: MatchPaymentContext
): Promise<MatchDecision> {
  return withTenantClient({ tenantId: ctx.tenantId }, async (client) => {
    // ─────────────────────────────────────────────────────────────────────
    // Strategy 0 — USER-CLAIMED TELEBIRR REFERENCE (most reliable of all).
    //
    // The player pasted the real Telebirr transaction reference into the
    // user panel; it is stored on their waiting deposit request. Telebirr
    // refs are globally unique per payment, so an exact match uniquely and
    // unambiguously identifies the depositing user. The credited amount is
    // always the real SMS amount, so an amount typo on the request is
    // harmless.
    // ─────────────────────────────────────────────────────────────────────
    if (parsed.telebirrRef) {
      const claimed = await repo.findOpenDepositRequestByClaimedRef(
        client,
        ctx.tenantId,
        parsed.telebirrRef
      );
      if (claimed) {
        return {
          kind: 'matched',
          strategy: 'claimed_ref',
          userId: claimed.user_id,
          depositRequestId: claimed.id,
        };
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Strategy 1 — REFERENCE CODE MATCH (most reliable).
    // ─────────────────────────────────────────────────────────────────────
    for (const candidate of parsed.noteCandidates) {
      const req = await repo.findOpenDepositRequestByCode(
        client,
        ctx.tenantId,
        candidate
      );
      if (!req) continue;
      if (Number(req.amount) !== Number(parsed.amount)) {
        // Code matched but amount disagrees → suspicious; fall through to
        // other strategies but record context for debugging.
        logger.warn(
          {
            tenantId: ctx.tenantId,
            agentId: ctx.agentId,
            code: candidate,
            req_amount: req.amount,
            sms_amount: parsed.amount,
            telebirr_ref: parsed.telebirrRef,
          },
          'telebirr: deposit-request reference code matched but amount mismatch'
        );
        continue;
      }
      return {
        kind: 'matched',
        strategy: 'reference_code',
        userId: req.user_id,
        depositRequestId: req.id,
      };
    }

    // ─────────────────────────────────────────────────────────────────────
    // Strategy 2 — AMOUNT + PHONE MATCH.
    // ─────────────────────────────────────────────────────────────────────
    if (parsed.senderPhone) {
      const user = await repo.findUserByPhone(
        client,
        ctx.tenantId,
        parsed.senderPhone
      );
      if (user) {
        const reqsForUser = await repo.findOpenDepositRequestsByAmount(client, {
          tenantId: ctx.tenantId,
          amount: String(parsed.amount),
          userId: user.id,
        });
        if (reqsForUser.length === 1) {
          return {
            kind: 'matched',
            strategy: 'amount_phone',
            userId: user.id,
            depositRequestId: reqsForUser[0].id,
          };
        }
        if (reqsForUser.length === 0) {
          // The user is known but has no open deposit request for this
          // amount. Spec wording allows "match confirmed with medium
          // confidence" on phone alone — but crediting without an
          // explicit request risks crediting accidental Telebirr
          // transfers as betting deposits. Be conservative: treat as a
          // probable match so a cashier can confirm.
          return {
            kind: 'probable_match',
            strategy: 'amount_window',
            candidateUserIds: [user.id],
            candidateDepositRequestIds: [],
          };
        }
        // Multiple open requests at the same amount for the same user —
        // unusual; bubble up as ambiguous.
        return {
          kind: 'ambiguous',
          strategy: 'amount_window',
          candidateUserIds: [user.id],
          candidateDepositRequestIds: reqsForUser.map((r) => r.id),
        };
      }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Strategy 3 — AMOUNT + TIME WINDOW MATCH.
    // ─────────────────────────────────────────────────────────────────────
    const windowStart = new Date(
      Date.now() - AMOUNT_WINDOW_MINUTES * 60 * 1000
    );
    const recentReqs = await repo.findOpenDepositRequestsByAmount(client, {
      tenantId: ctx.tenantId,
      amount: String(parsed.amount),
      minCreatedAt: windowStart,
    });
    if (recentReqs.length === 1) {
      return {
        kind: 'probable_match',
        strategy: 'amount_window',
        candidateUserIds: [recentReqs[0].user_id],
        candidateDepositRequestIds: [recentReqs[0].id],
      };
    }
    if (recentReqs.length > 1) {
      return {
        kind: 'ambiguous',
        strategy: 'amount_window',
        candidateUserIds: Array.from(
          new Set(recentReqs.map((r) => r.user_id))
        ),
        candidateDepositRequestIds: recentReqs.map((r) => r.id),
      };
    }

    return {
      kind: 'unmatched',
      reason:
        'no reference code, no user-by-phone, no recent deposit request at this amount',
    };
  });
}

/* ------------------------------------------------------------------------- */
/* Outcome handlers                                                          */
/* ------------------------------------------------------------------------- */

/**
 * Atomic credit pipeline. Runs in a single tenant-scoped transaction so
 * either every step lands or none of them do.
 */
async function creditMatch(
  parsed: ParsedSms,
  ctx: MatchPaymentContext,
  decision: MatchedDecision
): Promise<MatchPaymentResult> {
  type CreditTx = {
    telebirrTx: repo.TelebirrTransactionRow;
    walletLedger: repo.WalletLedgerRow;
    wallet: repo.WalletRow;
    user_phone: string | null;
  };

  let result: CreditTx;
  try {
    result = await withTenantClient(
      { tenantId: ctx.tenantId },
      async (client): Promise<CreditTx> => {
        // a) Lock + ensure wallet exists.
        const wallet = await repo.ensureWalletForUpdate(
          client,
          ctx.tenantId,
          decision.userId,
          'ETB'
        );
        if (wallet.status !== 'active') {
          throw new CreditAbort(
            `wallet status is ${wallet.status}; not crediting`
          );
        }

        const beforeBalance = wallet.balance;
        const amount = String(parsed.amount);

        // b) Apply the credit.
        const after = await repo.applyWalletCredit(client, wallet.id, amount);

        // c) Insert the wallet ledger row first; we use telebirr_ref as
        //    the idempotency reference. (Constraint on telebirr_ref is on
        //    telebirr_transactions, but we mirror the value here for
        //    cross-table joins.)
        const ledger = await repo.insertWalletLedgerTransaction(client, {
          tenantId: ctx.tenantId,
          walletId: wallet.id,
          userId: decision.userId,
          type: 'p2p_deposit',
          amount,
          beforeBalance,
          afterBalance: after.balance,
          currency: 'ETB',
          reference: parsed.telebirrRef!,
          metadata: {
            method: 'telebirr',
            strategy: decision.strategy,
            agent_id: ctx.agentId,
            sms_raw_id: ctx.smsRawId,
            telebirr_ref: parsed.telebirrRef,
            sender_phone: parsed.senderPhone,
            sender_name: parsed.senderName,
            deposit_request_id: decision.depositRequestId,
          },
        });

        // d) Insert the telebirr_transactions row. Unique-violation here
        //    means another worker beat us to it; bubble up so the outer
        //    catch can re-classify as 'duplicate'.
        const telebirrTx = await repo.insertTelebirrTransaction(client, {
          tenantId: ctx.tenantId,
          agentId: ctx.agentId,
          userId: decision.userId,
          walletId: wallet.id,
          telebirrRef: parsed.telebirrRef!,
          senderPhone: parsed.senderPhone,
          senderName: parsed.senderName,
          amount,
          currency: 'ETB',
          smsBody: null, // raw body lives in telebirr_sms_raw; avoid duplication
          status: 'credited',
          matchedAt: new Date(),
          creditedAt: new Date(),
          creditTransactionId: ledger.id,
        });

        // e) Confirm the deposit request (if there was one).
        if (decision.depositRequestId) {
          await repo.markDepositRequestConfirmed(
            client,
            decision.depositRequestId,
            telebirrTx.id
          );
        }

        // f) Mark the SMS row processed.
        await repo.markSmsProcessed(client, ctx.smsRawId);

        // g) Look up the user's phone for the cashier event payload.
        const userPhone = await fetchUserPhone(client, decision.userId);

        return {
          telebirrTx,
          walletLedger: ledger,
          wallet: after,
          user_phone: userPhone,
        };
      }
    );
  } catch (err) {
    return await handleCreditError(err, parsed, ctx);
  }

  // ─────────────────────── post-commit side effects ─────────────────────────
  // Failures below MUST NOT roll back the credit (it's already committed).

  await tryAudit(
    {
      tenantId: ctx.tenantId,
      actorId: ctx.agentId,
      actorType: 'telebirr_agent',
      action: 'telebirr.deposit.credit',
      resource: 'wallet',
      resourceId: result.wallet.id,
      payload: {
        strategy: decision.strategy,
        telebirr_transaction_id: result.telebirrTx.id,
        credit_transaction_id: result.walletLedger.id,
        deposit_request_id: decision.depositRequestId,
        agent_id: ctx.agentId,
        sms_raw_id: ctx.smsRawId,
        user_id: decision.userId,
        amount: String(parsed.amount),
        currency: 'ETB',
        telebirr_ref: parsed.telebirrRef,
        sender_phone: parsed.senderPhone,
        sender_name: parsed.senderName,
        before_balance: result.walletLedger.before_balance,
        after_balance: result.walletLedger.after_balance,
      },
      ip: null,
      userAgent: null,
      status: 'success',
    },
    { bypassRls: true }
  );

  // Reconcile the legacy p2p_deposits approval-queue row (created by the
  // agent batch pipeline for the same SMS). An auto-matched, successfully
  // credited deposit must NOT sit in the manual approval queue — admins
  // should only action UNMATCHED deposits. Best-effort: never rolls back
  // the (already committed) credit.
  if (parsed.telebirrRef) {
    try {
      await withTenantClient(
        { tenantId: ctx.tenantId, bypassRls: true },
        async (client) =>
          client.query(
            `UPDATE p2p_deposits
                SET status = 'approved',
                    user_id = COALESCE(user_id, $2),
                    approved_at = COALESCE(approved_at, now())
              WHERE tenant_id = $1
                AND telebirr_ref = $3
                AND status = 'pending'`,
            [ctx.tenantId, decision.userId, parsed.telebirrRef]
          )
      );
    } catch (err) {
      logger.warn(
        { err, tenantId: ctx.tenantId, telebirr_ref: parsed.telebirrRef },
        'telebirr: failed to reconcile p2p_deposits queue row after auto-credit'
      );
    }
  }

  emitDepositConfirmed(ctx.tenantId, decision.userId, {
    amount: String(parsed.amount),
    currency: 'ETB',
    telebirr_ref: parsed.telebirrRef!,
    telebirr_transaction_id: result.telebirrTx.id,
    wallet_balance: result.wallet.balance,
  });

  emitWalletUpdated(ctx.tenantId, decision.userId, {
    reason: 'telebirr_deposit',
    wallet: result.wallet,
    transaction_id: result.walletLedger.id,
  });

  emitNewDeposit(ctx.tenantId, {
    telebirr_transaction_id: result.telebirrTx.id,
    user_id: decision.userId,
    user_phone: result.user_phone,
    amount: String(parsed.amount),
    currency: 'ETB',
    method: 'telebirr',
    status: 'credited',
    sender_phone: parsed.senderPhone,
    sender_name: parsed.senderName,
    telebirr_ref: parsed.telebirrRef!,
    created_at: result.telebirrTx.created_at.toISOString(),
  });

  emitDepositSuccessful(ctx.tenantId, decision.userId, {
    amount: String(parsed.amount),
    currency: 'ETB',
    telebirr_ref: parsed.telebirrRef!,
    message: `ETB ${parsed.amount} has been credited to your wallet.`,
  });

  // Promotions side-effects (bonus engine, raffle tickets, referral
  // promotion). Detached so failures never reverse the credit.
  void runPostDepositPromotions({
    tenantId: ctx.tenantId,
    userId: decision.userId,
    amount: parsed.amount,
    source: 'telebirr_auto_match',
    metadata: {
      telebirr_ref: parsed.telebirrRef,
      strategy: decision.strategy,
    },
  });

  // RULE 5 — post-credit daily volume cap. Best-effort: a failure here
  // must NEVER reverse the credit (it's already committed). We swallow
  // errors and just log so a transient DB blip doesn't bypass the
  // suspension on the next credit instead.
  try {
    await withTenantClient({ tenantId: ctx.tenantId }, async (client) => {
      const settings = await loadTelebirrSettings(client, ctx.tenantId);
      const verdict = await checkAgentDailyVolumeCap(
        client,
        ctx.tenantId,
        ctx.agentId,
        settings
      );
      if (verdict.shouldSuspend) {
        await suspendAgentForFraud(client, {
          tenantId: ctx.tenantId,
          agentId: ctx.agentId,
          reason: `daily volume cap exceeded (${verdict.totalToday} ETB > ${verdict.capacity} ETB)`,
          payload: {
            total_today: verdict.totalToday,
            count_today: verdict.countToday,
            capacity: verdict.capacity,
            triggering_telebirr_ref: parsed.telebirrRef,
          },
        });
      }
    });
  } catch (err) {
    logger.error(
      { err, agentId: ctx.agentId, tenantId: ctx.tenantId },
      'telebirr: post-credit daily volume cap check failed'
    );
  }

  return {
    outcome: 'credited',
    reason: `matched via ${decision.strategy}`,
    telebirrTransactionId: result.telebirrTx.id,
    creditTransactionId: result.walletLedger.id,
    depositRequestId: decision.depositRequestId,
    matchedUserId: decision.userId,
    strategy: decision.strategy,
  };
}

/**
 * Strategy 3 / Strategy 2 fallthrough → store the SMS as a non-credited
 * telebirr_transactions row in the appropriate state and notify cashiers.
 */
async function persistAmbiguous(
  parsed: ParsedSms,
  ctx: MatchPaymentContext,
  decision: ProbableDecision | AmbiguousDecision,
  outcome: 'probable_match' | 'ambiguous'
): Promise<MatchPaymentResult> {
  const status: 'matched' | 'pending' = 'pending';
  const tx = await persistTelebirrTransactionOnly(parsed, ctx, status);
  if (!tx) {
    // Race: another worker already inserted this telebirr_ref.
    return duplicateResult(parsed);
  }
  await markSmsProcessedSafe(ctx);
  await tryAudit(
    {
      tenantId: ctx.tenantId,
      actorId: ctx.agentId,
      actorType: 'telebirr_agent',
      action: `telebirr.deposit.${outcome}`,
      resource: 'telebirr_transaction',
      resourceId: tx.id,
      payload: {
        candidate_user_ids: decision.candidateUserIds,
        candidate_deposit_request_ids: decision.candidateDepositRequestIds,
        amount: String(parsed.amount),
        currency: 'ETB',
        telebirr_ref: parsed.telebirrRef,
        sender_phone: parsed.senderPhone,
        sender_name: parsed.senderName,
        agent_id: ctx.agentId,
        sms_raw_id: ctx.smsRawId,
      },
      ip: null,
      userAgent: null,
      status: outcome === 'probable_match' ? 'warning' : 'warning',
    },
    { bypassRls: true }
  );
  emitNewDeposit(ctx.tenantId, {
    telebirr_transaction_id: tx.id,
    user_id: null,
    user_phone: null,
    amount: String(parsed.amount),
    currency: 'ETB',
    method: 'telebirr',
    status: outcome,
    sender_phone: parsed.senderPhone,
    sender_name: parsed.senderName,
    telebirr_ref: parsed.telebirrRef!,
    created_at: tx.created_at.toISOString(),
  });
  return {
    outcome,
    reason:
      outcome === 'probable_match'
        ? 'single candidate found — awaiting cashier confirmation'
        : 'multiple candidates found — needs cashier disambiguation',
    telebirrTransactionId: tx.id,
    creditTransactionId: null,
    depositRequestId: null,
    matchedUserId: null,
    strategy: 'amount_window',
  };
}

async function persistUnmatched(
  parsed: ParsedSms,
  ctx: MatchPaymentContext,
  reason: string
): Promise<MatchPaymentResult> {
  const tx = await persistTelebirrTransactionOnly(parsed, ctx, 'unmatched');
  if (!tx) return duplicateResult(parsed);
  await markSmsProcessedSafe(ctx);
  await tryAudit(
    {
      tenantId: ctx.tenantId,
      actorId: ctx.agentId,
      actorType: 'telebirr_agent',
      action: 'telebirr.deposit.unmatched',
      resource: 'telebirr_transaction',
      resourceId: tx.id,
      payload: {
        reason,
        amount: String(parsed.amount),
        currency: 'ETB',
        telebirr_ref: parsed.telebirrRef,
        sender_phone: parsed.senderPhone,
        sender_name: parsed.senderName,
        agent_id: ctx.agentId,
        sms_raw_id: ctx.smsRawId,
      },
      ip: null,
      userAgent: null,
      status: 'warning',
    },
    { bypassRls: true }
  );
  emitNewDeposit(ctx.tenantId, {
    telebirr_transaction_id: tx.id,
    user_id: null,
    user_phone: null,
    amount: String(parsed.amount),
    currency: 'ETB',
    method: 'telebirr',
    status: 'unmatched',
    sender_phone: parsed.senderPhone,
    sender_name: parsed.senderName,
    telebirr_ref: parsed.telebirrRef ?? '',
    created_at: tx.created_at.toISOString(),
  });
  return {
    outcome: 'unmatched',
    reason,
    telebirrTransactionId: tx.id,
    creditTransactionId: null,
    depositRequestId: null,
    matchedUserId: null,
    strategy: 'none',
  };
}

/* ------------------------------------------------------------------------- */
/* Helpers                                                                   */
/* ------------------------------------------------------------------------- */

class CreditAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditAbort';
  }
}

async function persistTelebirrTransactionOnly(
  parsed: ParsedSms,
  ctx: MatchPaymentContext,
  status: 'pending' | 'unmatched'
): Promise<repo.TelebirrTransactionRow | null> {
  if (!parsed.telebirrRef) {
    // For unmatched-without-ref we still need a stable surrogate so the
    // cashier UI can show one card per SMS. Fall back to a deterministic
    // fake ref derived from sms_raw_id so retries are still idempotent.
    parsed = { ...parsed, telebirrRef: `SMS-${ctx.smsRawId}` };
  }
  try {
    return await withTenantClient({ tenantId: ctx.tenantId }, async (client) =>
      repo.insertTelebirrTransaction(client, {
        tenantId: ctx.tenantId,
        agentId: ctx.agentId,
        userId: null,
        walletId: null,
        telebirrRef: parsed.telebirrRef!,
        senderPhone: parsed.senderPhone,
        senderName: parsed.senderName,
        amount: String(parsed.amount || 0),
        currency: 'ETB',
        smsBody: null,
        status,
        matchedAt: null,
        creditedAt: null,
        creditTransactionId: null,
      })
    );
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code === UNIQUE_VIOLATION) {
      logger.info(
        { tenantId: ctx.tenantId, telebirr_ref: parsed.telebirrRef },
        'telebirr: ref already on file — skipping persist'
      );
      return null;
    }
    throw err;
  }
}

async function fetchUserPhone(
  client: PoolClient,
  userId: string
): Promise<string | null> {
  const r = await client.query<{ phone: string | null }>(
    `SELECT phone FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return r.rows[0]?.phone ?? null;
}

async function markSmsProcessedSafe(ctx: MatchPaymentContext): Promise<void> {
  try {
    await withTenantClient({ tenantId: ctx.tenantId }, async (client) =>
      repo.markSmsProcessed(client, ctx.smsRawId)
    );
  } catch (err) {
    logger.error(
      { err, tenantId: ctx.tenantId, smsRawId: ctx.smsRawId },
      'telebirr: failed to mark sms_raw processed'
    );
  }
}

async function handleCreditError(
  err: unknown,
  parsed: ParsedSms,
  ctx: MatchPaymentContext
): Promise<MatchPaymentResult> {
  const code = (err as { code?: string } | null)?.code;
  if (code === UNIQUE_VIOLATION) {
    // Concurrent insert won the race. Re-read to surface the canonical
    // record to the caller.
    const dup = await withTenantClient(
      { tenantId: ctx.tenantId },
      async (client) => repo.findTelebirrTxByRef(client, parsed.telebirrRef!)
    );
    await markSmsProcessedSafe(ctx);
    return {
      outcome: 'duplicate',
      reason: 'telebirr_ref already credited by a concurrent worker',
      telebirrTransactionId: dup?.id ?? null,
      creditTransactionId: dup?.credit_transaction_id ?? null,
      depositRequestId: null,
      matchedUserId: dup?.user_id ?? null,
      strategy: null,
    };
  }
  if (err instanceof CreditAbort) {
    logger.warn(
      { tenantId: ctx.tenantId, telebirr_ref: parsed.telebirrRef, msg: err.message },
      'telebirr: credit aborted'
    );
    return await persistUnmatched(parsed, ctx, err.message);
  }
  logger.error(
    { err, tenantId: ctx.tenantId, telebirr_ref: parsed.telebirrRef },
    'telebirr: unexpected error during credit'
  );
  throw err;
}

function duplicateResult(parsed: ParsedSms): MatchPaymentResult {
  return {
    outcome: 'duplicate',
    reason: `telebirr_ref ${parsed.telebirrRef} already on file`,
    telebirrTransactionId: null,
    creditTransactionId: null,
    depositRequestId: null,
    matchedUserId: null,
    strategy: null,
  };
}

/* ------------------------------------------------------------------------- */
/* Manual confirmation                                                       */
/* ------------------------------------------------------------------------- */

/**
 * Credit a previously persisted-but-uncredited Telebirr transaction
 * against a user picked manually (by an agent / cashier).
 *
 * Allowed source statuses: `pending`, `unmatched`. Anything else
 * (`credited`, `duplicate`, `disputed`) is a no-op or an error so that
 * a confirm action can never double-credit.
 *
 * Side effects mirror `matchPayment`'s success path: audit + four
 * socket emits, all post-commit.
 */
export interface ConfirmManualMatchInput {
  /** Performer of the action. `'cashier'` for /api/cashier flows,
   *  `'telebirr_agent'` when the device performs a self-confirm,
   *  `'user'` when the depositing player self-confirms via the claimed
   *  Telebirr reference (the SMS had already arrived at initiate time). */
  actorType: 'telebirr_agent' | 'cashier' | 'admin' | 'user';
  /** id of the actor (agentId / cashierId / adminId). */
  actorId: string;
  ip: string | null;
  userAgent: string | null;
}

export interface ConfirmManualMatchResult {
  outcome: 'credited' | 'duplicate' | 'rejected';
  reason: string;
  telebirrTransactionId: string;
  creditTransactionId: string | null;
  matchedUserId: string;
}

export async function confirmManualMatch(
  tenantId: string,
  telebirrRef: string,
  userId: string,
  input: ConfirmManualMatchInput
): Promise<ConfirmManualMatchResult> {
  // Lazy import to avoid a circular reference: agent.repository imports
  // from us already (via index.ts callers), and we don't want a
  // top-level cycle.
  const agentRepo = await import('../agent/agent.repository');

  type Out = {
    telebirrTxId: string;
    creditTxId: string | null;
    walletBalance: string;
    userPhone: string | null;
    amount: string;
    senderPhone: string | null;
    senderName: string | null;
    agentId: string;
    createdAt: Date;
  };

  let result: Out;
  try {
    result = await withTenantClient(
      { tenantId },
      async (client): Promise<Out> => {
        const tx = await agentRepo.findPendingTxByRefForUpdate(
          client,
          tenantId,
          telebirrRef
        );
        if (!tx) {
          throw new ManualConfirmError(
            'rejected',
            `no telebirr_transactions row for ref ${telebirrRef}`
          );
        }
        if (tx.status === 'credited') {
          throw new ManualConfirmError(
            'duplicate',
            'transaction already credited'
          );
        }
        if (tx.status !== 'pending' && tx.status !== 'unmatched') {
          throw new ManualConfirmError(
            'rejected',
            `cannot confirm transaction in status ${tx.status}`
          );
        }
        if (Number(tx.amount) <= 0) {
          throw new ManualConfirmError(
            'rejected',
            'transaction has non-positive amount'
          );
        }

        const wallet = await repo.ensureWalletForUpdate(
          client,
          tenantId,
          userId,
          tx.currency
        );
        if (wallet.status !== 'active') {
          throw new ManualConfirmError(
            'rejected',
            `target wallet status is ${wallet.status}`
          );
        }

        const beforeBalance = wallet.balance;
        const after = await repo.applyWalletCredit(
          client,
          wallet.id,
          tx.amount
        );
        const ledger = await repo.insertWalletLedgerTransaction(client, {
          tenantId,
          walletId: wallet.id,
          userId,
          type: 'p2p_deposit',
          amount: tx.amount,
          beforeBalance,
          afterBalance: after.balance,
          currency: tx.currency,
          reference: tx.telebirr_ref,
          metadata: {
            method: 'telebirr',
            strategy: 'manual_confirm',
            actor_type: input.actorType,
            actor_id: input.actorId,
            telebirr_ref: tx.telebirr_ref,
            telebirr_transaction_id: tx.id,
            sender_phone: tx.sender_phone,
            sender_name: tx.sender_name,
          },
        });

        await agentRepo.markTelebirrTxCredited(
          client,
          tx.id,
          ledger.id,
          wallet.id,
          userId
        );

        const userPhone = await fetchUserPhone(client, userId);

        return {
          telebirrTxId: tx.id,
          creditTxId: ledger.id,
          walletBalance: after.balance,
          userPhone,
          amount: tx.amount,
          senderPhone: tx.sender_phone,
          senderName: tx.sender_name,
          agentId: tx.agent_id,
          createdAt: new Date(),
        };
      }
    );
  } catch (err) {
    if (err instanceof ManualConfirmError) {
      return {
        outcome: err.kind,
        reason: err.message,
        telebirrTransactionId: '',
        creditTransactionId: null,
        matchedUserId: userId,
      };
    }
    throw err;
  }

  // Post-commit side effects — same as auto-match success.
  await tryAudit(
    {
      tenantId,
      actorId: input.actorId,
      actorType: input.actorType,
      action: 'telebirr.deposit.manual_confirm',
      resource: 'telebirr_transaction',
      resourceId: result.telebirrTxId,
      payload: {
        strategy: 'manual_confirm',
        amount: result.amount,
        currency: 'ETB',
        telebirr_ref: telebirrRef,
        user_id: userId,
        agent_id: result.agentId,
        credit_transaction_id: result.creditTxId,
      },
      ip: input.ip,
      userAgent: input.userAgent,
      status: 'success',
    },
    { bypassRls: true }
  );

  emitDepositConfirmed(tenantId, userId, {
    amount: result.amount,
    currency: 'ETB',
    telebirr_ref: telebirrRef,
    telebirr_transaction_id: result.telebirrTxId,
    wallet_balance: result.walletBalance,
  });
  emitWalletUpdated(tenantId, userId, {
    reason: 'telebirr_deposit_manual',
    wallet: { balance: result.walletBalance },
    transaction_id: result.creditTxId,
  });
  emitNewDeposit(tenantId, {
    telebirr_transaction_id: result.telebirrTxId,
    user_id: userId,
    user_phone: result.userPhone,
    amount: result.amount,
    currency: 'ETB',
    method: 'telebirr',
    status: 'credited',
    sender_phone: result.senderPhone,
    sender_name: result.senderName,
    telebirr_ref: telebirrRef,
    created_at: result.createdAt.toISOString(),
  });
  emitDepositSuccessful(tenantId, userId, {
    amount: result.amount,
    currency: 'ETB',
    telebirr_ref: telebirrRef,
    message: `ETB ${result.amount} has been credited to your wallet.`,
  });

  // Same post-deposit promotion hooks as the auto-match path so cashier
  // manual confirmations also trigger bonus awards / raffle tickets /
  // referral promotion.
  void runPostDepositPromotions({
    tenantId,
    userId,
    amount: result.amount,
    source: 'telebirr_manual_confirm',
    metadata: { telebirr_ref: telebirrRef, agent_id: result.agentId },
  });

  return {
    outcome: 'credited',
    reason: 'manual confirmation succeeded',
    telebirrTransactionId: result.telebirrTxId,
    creditTransactionId: result.creditTxId,
    matchedUserId: userId,
  };
}

class ManualConfirmError extends Error {
  constructor(
    public readonly kind: 'rejected' | 'duplicate',
    message: string
  ) {
    super(message);
    this.name = 'ManualConfirmError';
  }
}

/* ------------------------------------------------------------------------- */
/* Void                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Reverse a previously-credited Telebirr transaction.
 *
 * What this does:
 *   1. Lock the wallet that received the credit.
 *   2. Apply an atomic debit equal to the credited amount. If the
 *      wallet doesn't have enough balance to absorb the void, fail
 *      with `insufficient_balance`. Operators must seek the missing
 *      funds through dispute channels.
 *   3. Insert a reversal ledger row (negative amount, type='adjustment',
 *      reference includes the original telebirr_ref + a `void:` prefix
 *      so it doesn't collide with the original credit's idempotency
 *      key).
 *   4. Reset `telebirr_transactions` back to `unmatched` so the row
 *      becomes available for re-matching to the correct user.
 *   5. Audit + emit WALLET_UPDATED to the affected user.
 *
 * Threshold checks (admin-approval-required for large voids) are
 * enforced by the caller — this service is unconditional once invoked.
 */
export interface VoidInput {
  actorType: 'cashier' | 'admin';
  actorId: string;
  reason: string;
  ip: string | null;
  userAgent: string | null;
}

export interface VoidResult {
  outcome: 'voided' | 'rejected';
  reason: string;
  telebirrTransactionId: string;
  reversalTransactionId: string | null;
  affectedUserId: string | null;
}

export async function voidCreditedTransaction(
  tenantId: string,
  telebirrTransactionId: string,
  input: VoidInput
): Promise<VoidResult> {
  const agentRepo = await import('../agent/agent.repository');

  type Out = {
    telebirrTxId: string;
    reversalLedgerId: string;
    userId: string;
    walletBalance: string;
    amount: string;
  };

  let outcome: Out;
  try {
    outcome = await withTenantClient(
      { tenantId },
      async (client): Promise<Out> => {
        const r = await client.query<{
          id: string;
          tenant_id: string;
          user_id: string | null;
          wallet_id: string | null;
          telebirr_ref: string;
          amount: string;
          currency: string;
          status: string;
          credit_transaction_id: string | null;
        }>(
          `SELECT id, tenant_id, user_id, wallet_id, telebirr_ref, amount,
                  currency, status, credit_transaction_id
             FROM telebirr_transactions
            WHERE tenant_id = $1 AND id = $2
            FOR UPDATE`,
          [tenantId, telebirrTransactionId]
        );
        const row = r.rows[0];
        if (!row) {
          throw new VoidError('rejected', 'transaction not found');
        }
        if (row.status !== 'credited') {
          throw new VoidError(
            'rejected',
            `transaction is in status ${row.status}; only credited transactions can be voided`
          );
        }
        if (!row.user_id || !row.wallet_id) {
          throw new VoidError(
            'rejected',
            'credited transaction has no linked user/wallet'
          );
        }

        // Lock the wallet for update.
        const wRes = await client.query<{
          id: string;
          balance: string;
          status: string;
          tenant_id: string;
          user_id: string;
          currency: string;
        }>(
          `SELECT id, balance, status, tenant_id, user_id, currency
             FROM wallets WHERE id = $1 FOR UPDATE`,
          [row.wallet_id]
        );
        const wallet = wRes.rows[0];
        if (!wallet) throw new VoidError('rejected', 'wallet not found');
        if (wallet.status !== 'active') {
          throw new VoidError(
            'rejected',
            `cannot void into wallet with status ${wallet.status}`
          );
        }

        const beforeBalance = wallet.balance;
        const debitRes = await client.query<{ balance: string }>(
          `UPDATE wallets
              SET balance    = balance - $2::numeric,
                  version    = version + 1,
                  updated_at = now()
            WHERE id = $1 AND balance >= $2::numeric
            RETURNING balance`,
          [wallet.id, row.amount]
        );
        if (!debitRes.rows[0]) {
          throw new VoidError(
            'rejected',
            'insufficient wallet balance to absorb the void; user may have already spent the credited funds'
          );
        }
        const afterBalance = debitRes.rows[0].balance;

        const ledger = await client.query<{ id: string }>(
          `INSERT INTO transactions
             (tenant_id, wallet_id, user_id, type, amount,
              before_balance, after_balance, currency, reference,
              metadata, status)
           VALUES ($1, $2, $3, 'adjustment', ('-' || $4)::numeric,
                   $5::numeric, $6::numeric, $7,
                   'void:' || $8, $9::jsonb, 'completed')
           RETURNING id`,
          [
            tenantId,
            wallet.id,
            wallet.user_id,
            row.amount,
            beforeBalance,
            afterBalance,
            wallet.currency,
            row.telebirr_ref,
            JSON.stringify({
              method: 'telebirr',
              strategy: 'void',
              actor_type: input.actorType,
              actor_id: input.actorId,
              reason: input.reason,
              telebirr_transaction_id: row.id,
              telebirr_ref: row.telebirr_ref,
              original_credit_transaction_id: row.credit_transaction_id,
            }),
          ]
        );

        // Reset telebirr_transactions back to unmatched so the row is
        // re-matchable to the correct user.
        await client.query(
          `UPDATE telebirr_transactions
              SET status = 'unmatched',
                  user_id = NULL,
                  wallet_id = NULL,
                  matched_at = NULL,
                  credited_at = NULL,
                  credit_transaction_id = NULL
            WHERE id = $1`,
          [row.id]
        );

        return {
          telebirrTxId: row.id,
          reversalLedgerId: ledger.rows[0].id,
          userId: wallet.user_id,
          walletBalance: afterBalance,
          amount: row.amount,
        };
      }
    );
  } catch (err) {
    if (err instanceof VoidError) {
      return {
        outcome: err.kind === 'rejected' ? 'rejected' : 'rejected',
        reason: err.message,
        telebirrTransactionId,
        reversalTransactionId: null,
        affectedUserId: null,
      };
    }
    throw err;
  }
  // Avoid an "unused import" lint when the agent repo is only needed
  // for confirmManualMatch above.
  void agentRepo;

  await tryAudit(
    {
      tenantId,
      actorId: input.actorId,
      actorType: input.actorType,
      action: 'telebirr.deposit.void',
      resource: 'telebirr_transaction',
      resourceId: outcome.telebirrTxId,
      payload: {
        reason: input.reason,
        amount: outcome.amount,
        currency: 'ETB',
        reversal_transaction_id: outcome.reversalLedgerId,
        affected_user_id: outcome.userId,
      },
      ip: input.ip,
      userAgent: input.userAgent,
      status: 'success',
    },
    { bypassRls: true }
  );

  emitWalletUpdated(tenantId, outcome.userId, {
    reason: 'telebirr_void',
    wallet: { balance: outcome.walletBalance },
    transaction_id: outcome.reversalLedgerId,
  });

  return {
    outcome: 'voided',
    reason: 'reversal applied; transaction back to unmatched',
    telebirrTransactionId: outcome.telebirrTxId,
    reversalTransactionId: outcome.reversalLedgerId,
    affectedUserId: outcome.userId,
  };
}

class VoidError extends Error {
  constructor(public readonly kind: 'rejected', message: string) {
    super(message);
    this.name = 'VoidError';
  }
}
