/**
 * Provider-agnostic Telebirr deposit business logic.
 *
 * `user/deposits-telebirr.service.ts` and `TelebirrP2PProvider` both
 * delegate here so the deposit-initiate / status-poll behaviour is
 * the SAME no matter which entry point the user hits. The HTTP layer
 * (and any future webhook / SDK layer) keeps responsibility for:
 *   - auth scope resolution (tenant + user from req.user)
 *   - audit logging
 *   - request/response shape adaptation
 *
 * This module deliberately accepts plain values (tenantId, userId,
 * amount, …) so it can be called from layers that don't have an
 * Express `Request` (e.g. an automated re-attempt job in the future).
 */

import {
  BadRequestError,
  TooManyRequestsError,
} from '../../http/errors/http-error';
import {
  auditFraudSignal,
  checkRefcodeBruteForce,
} from './telebirr.fraud';
import { generateUniqueReferenceCode } from './telebirr.refcode';
import * as repo from './telebirr.repository';
import { loadTelebirrSettings } from './telebirr.settings';
import { withTenantClient } from '../../infrastructure/db/tenant-client';

/**
 * Window during which an agent device's last_seen_at must fall to be
 * considered "online" for the purposes of routing a fresh deposit
 * request. Three minutes follows the gateway-aggregator spec; the
 * Flutter app heartbeats every 60 s so a 3-minute window survives
 * transient network drops without picking truly offline devices.
 */
const AGENT_ONLINE_WINDOW_MS = 3 * 60 * 1000;

/** Soft warning threshold for "agent is busy" responses. */
const AGENT_BUSY_WARN_THRESHOLD = 10;

export interface InitiateTelebirrDepositInput {
  tenantId: string;
  userId: string;
  /** Decimal string. */
  amount: string;
  ip: string | null;
  userAgent: string | null;
}

export interface InitiateTelebirrDepositResult {
  request_id: string;
  reference_code: string;
  telebirr_number: string;
  agent_id: string;
  agent_name: string;
  amount: string;
  currency: 'ETB';
  expires_at: string;
  instructions: string;
  /** True when the only available agent already has many open
   *  requests; the UI should warn the user about possible delay. */
  agent_busy: boolean;
}

/**
 * Idempotent normative checks live here so any caller — HTTP route,
 * provider abstraction, future automation — gets the same answers.
 *
 * Throws:
 *   - BadRequestError(provider_disabled)   when settings.p2p_enabled=false
 *   - BadRequestError(below_min_deposit)
 *   - BadRequestError(exceeds_max_deposit)
 *   - BadRequestError(open_request_exists)
 *   - BadRequestError(no_agent_available)
 *   - TooManyRequestsError(refcode_brute_force)
 */
export async function initiateTelebirrDeposit(
  input: InitiateTelebirrDepositInput
): Promise<InitiateTelebirrDepositResult> {
  return withTenantClient({ tenantId: input.tenantId }, async (client) => {
    const settings = await loadTelebirrSettings(client, input.tenantId);

    if (!settings.p2p_enabled) {
      throw new BadRequestError(
        'Telebirr P2P deposits are temporarily disabled for this tenant.',
        { reason: 'provider_disabled' }
      );
    }

    const amountNum = Number(input.amount);
    if (amountNum < settings.min_deposit) {
      throw new BadRequestError(
        `Amount below minimum Telebirr deposit (${settings.min_deposit} ETB)`,
        { reason: 'below_min_deposit', min: settings.min_deposit }
      );
    }
    if (amountNum > settings.max_deposit) {
      throw new BadRequestError(
        `Amount exceeds maximum Telebirr deposit (${settings.max_deposit} ETB)`,
        { reason: 'exceeds_max_deposit', max: settings.max_deposit }
      );
    }

    const open = await repo.findUserOpenDepositRequest(
      client,
      input.tenantId,
      input.userId
    );
    if (open) {
      throw new BadRequestError(
        'You already have an open Telebirr deposit request. Cancel it first.',
        {
          reason: 'open_request_exists',
          request_id: open.id,
          reference_code: open.reference_code,
          expires_at: open.expires_at.toISOString(),
        }
      );
    }

    const cutoff = new Date(Date.now() - AGENT_ONLINE_WINDOW_MS);
    const agent = await repo.pickAvailableAgent(
      client,
      input.tenantId,
      cutoff
    );
    if (!agent) {
      throw new BadRequestError(
        'P2P deposits temporarily unavailable. Please use cashier.',
        { reason: 'no_agent_available' }
      );
    }

    // After picking, advance the round-robin pointer so the NEXT
    // request goes to a different agent (when one exists). Done in
    // the same transaction as the deposit insert so a rollback does
    // not bias the rotation.
    await repo.markAgentAssigned(client, agent.id);

    // Tally pending requests on this number so the UI can warn the
    // user when the only-online agent is overloaded. We do this AFTER
    // picking to avoid an extra query when no agent exists.
    const pendingForAgent = await repo.countPendingForAgent(
      client,
      input.tenantId,
      agent.telebirr_number
    );
    const agentBusy = pendingForAgent >= AGENT_BUSY_WARN_THRESHOLD;

    const referenceCode = await generateUniqueReferenceCode(
      {
        prefix: settings.reference_code_prefix,
        length: settings.reference_code_length,
      },
      async (candidate) =>
        repo.isReferenceCodeAvailable(client, input.tenantId, candidate)
    );

    // RULE 8 — refcode brute-force guard. Unchanged from the previous
    // call site; we still throw 429 when too many distinct refcodes
    // get generated by the same user in the configured window.
    const verdict = await checkRefcodeBruteForce(client, {
      tenantId: input.tenantId,
      identifierType: 'user',
      identifier: input.userId,
      refcode: referenceCode,
      context: 'deposit_initiate',
      ip: input.ip,
      userAgent: input.userAgent,
      settings,
    });
    if (verdict.blocked) {
      void auditFraudSignal({
        tenantId: input.tenantId,
        rule: 'rule8_brute_force',
        resource: 'user',
        resourceId: input.userId,
        payload: {
          attempt_count: verdict.attemptCount,
          threshold: verdict.threshold,
          window_minutes: verdict.windowMinutes,
          context: 'deposit_initiate',
        },
        ip: input.ip,
        userAgent: input.userAgent,
      });
      throw new TooManyRequestsError(
        'Too many deposit-initiation attempts in a short window. Please wait before trying again.',
        {
          reason: 'refcode_brute_force',
          window_minutes: verdict.windowMinutes,
          threshold: verdict.threshold,
        }
      );
    }

    const expiresAt = new Date(
      Date.now() + settings.expiry_minutes * 60 * 1000
    );

    const request = await repo.insertDepositRequest(client, {
      tenantId: input.tenantId,
      userId: input.userId,
      amount: input.amount,
      telebirrNumber: agent.telebirr_number,
      referenceCode,
      expiresAt,
    });

    return {
      request_id: request.id,
      reference_code: request.reference_code,
      telebirr_number: agent.telebirr_number,
      agent_id: agent.id,
      agent_name: agent.agent_name,
      amount: input.amount,
      currency: 'ETB' as const,
      expires_at: expiresAt.toISOString(),
      instructions: buildInstructions(
        input.amount,
        agent.telebirr_number,
        request.reference_code
      ),
      agent_busy: agentBusy,
    };
  });
}

export function buildInstructions(
  amount: string,
  telebirrNumber: string,
  referenceCode: string
): string {
  return (
    `Send exactly ETB ${amount} to ${telebirrNumber} via Telebirr. ` +
    `Include code ${referenceCode} in the note/reason field.`
  );
}

/* ------------------------------------------------------------------------- */
/* Status                                                                    */
/* ------------------------------------------------------------------------- */

export interface TelebirrDepositStatusResult {
  request_id: string;
  status: 'waiting' | 'confirmed' | 'expired' | 'cancelled';
  amount: string;
  reference_code: string;
  telebirr_number: string;
  expires_at: string;
  credited_amount: string | null;
  telebirr_ref: string | null;
  matched_transaction_id: string | null;
  /** Server-side seconds until expiry; negative when already past expires_at. */
  seconds_until_expiry: number;
  /** Set when the caller was the owning user — false for admin lookups. */
  belongs_to_caller: boolean;
}

/**
 * Look up a deposit request by id within a tenant, with optional
 * ownership filtering. When `expectUserId` is set, mismatches return
 * null (the route layer turns that into a 404 to avoid leaking the
 * existence of someone else's id).
 */
export async function getTelebirrDepositStatus(input: {
  tenantId: string;
  requestId: string;
  expectUserId?: string | null;
}): Promise<TelebirrDepositStatusResult | null> {
  return withTenantClient({ tenantId: input.tenantId }, async (client) => {
    const request = await repo.findDepositRequestById(
      client,
      input.tenantId,
      input.requestId
    );
    if (!request) return null;

    const belongsToCaller =
      !input.expectUserId || request.user_id === input.expectUserId;
    if (input.expectUserId && !belongsToCaller) return null;

    let status = request.status as TelebirrDepositStatusResult['status'];
    if (status === 'waiting' && request.expires_at < new Date()) {
      status = 'expired';
    }

    let creditedAmount: string | null = null;
    let telebirrRef: string | null = null;
    if (request.matched_transaction_id) {
      const tx = await client.query<{
        amount: string;
        telebirr_ref: string;
      }>(
        `SELECT amount, telebirr_ref FROM telebirr_transactions WHERE id = $1 LIMIT 1`,
        [request.matched_transaction_id]
      );
      if (tx.rows[0]) {
        creditedAmount = tx.rows[0].amount;
        telebirrRef = tx.rows[0].telebirr_ref;
      }
    }

    const secondsUntilExpiry = Math.floor(
      (request.expires_at.getTime() - Date.now()) / 1000
    );

    return {
      request_id: request.id,
      status,
      amount: request.amount,
      reference_code: request.reference_code,
      telebirr_number: request.telebirr_number,
      expires_at: request.expires_at.toISOString(),
      credited_amount: creditedAmount,
      telebirr_ref: telebirrRef,
      matched_transaction_id: request.matched_transaction_id,
      seconds_until_expiry: secondsUntilExpiry,
      belongs_to_caller: belongsToCaller,
    };
  });
}
