import type { PoolClient } from 'pg';

import { logger } from '../../infrastructure/logger';
import { tryAudit } from '../audit/audit.service';

import * as repo from './telebirr.repository';
import type { TelebirrSettings } from './telebirr.settings';

/**
 * Centralised Telebirr fraud-prevention rule engine.
 *
 * Each rule below is a pure-as-possible function: caller passes the
 * relevant inputs + tenant-loaded settings, and the function returns a
 * verdict the caller can act on. Audit logs and side effects are emitted
 * by the rule when the violation is severe enough to warrant a record
 * — callers don't have to remember which rule audits and which doesn't.
 *
 * Rules:
 *   RULE 3 — SMS timestamp window ............. validateSmsTimestamp
 *   RULE 4 — single-SMS amount ceiling ......... checkAmountCeiling
 *   RULE 5 — agent daily volume cap ............ checkAgentDailyVolumeCap
 *   RULE 6 — sender phone velocity ............. checkSenderPhoneVelocity
 *   RULE 7 — telecom sender allowlist .......... validateSenderAllowlist
 *   RULE 8 — refcode brute force ............... checkRefcodeBruteForce
 *
 * Rules 1 and 2 are not implemented here — the telebirr_ref unique
 * constraint and the agent device-binding middleware enforce them at
 * the database / HTTP layer respectively.
 */

/* ------------------------------------------------------------------------- */
/* RULE 3 — SMS timestamp window                                             */
/* ------------------------------------------------------------------------- */

export type TimestampVerdict =
  | { ok: true }
  | { ok: false; reason: string; skewSeconds: number };

/**
 * The device-reported `received_at` must be within ±skew minutes of
 * server time. Outside that window we reject the SMS as a possible
 * replay. We tolerate a generous default (10 min) so devices with
 * loose system clocks (no NTP) can still operate.
 */
export function validateSmsTimestamp(
  receivedAt: Date | null,
  settings: TelebirrSettings,
  now: Date = new Date()
): TimestampVerdict {
  if (!receivedAt) {
    // Missing receivedAt isn't a fraud signal — most parsers fall back
    // to "we received it just now" — pass.
    return { ok: true };
  }
  const skewMs = Math.abs(now.getTime() - receivedAt.getTime());
  const skewSeconds = Math.round(skewMs / 1000);
  const limitMs = settings.sms_timestamp_skew_minutes * 60 * 1000;
  if (skewMs > limitMs) {
    return {
      ok: false,
      reason: `received_at is ${skewSeconds}s away from server clock; max allowed is ${
        settings.sms_timestamp_skew_minutes * 60
      }s`,
      skewSeconds,
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------------- */
/* RULE 4 — amount ceiling escalation                                        */
/* ------------------------------------------------------------------------- */

export type AmountCeilingVerdict =
  | { kind: 'ok' }
  | { kind: 'escalate'; reason: string }
  | { kind: 'reject'; reason: string };

/**
 * Per-SMS amount ceiling. We use the spec's hard rule: above
 * `max_single_sms_amount` we escalate to manual review even when
 * everything else (reference code, phone match) lined up. We don't
 * outright reject — the legitimate "agent received a 60k payment"
 * case still needs a credit path, just one a human approves.
 */
export function checkAmountCeiling(
  amount: number,
  settings: TelebirrSettings
): AmountCeilingVerdict {
  if (amount > settings.max_single_sms_amount) {
    return {
      kind: 'escalate',
      reason: `amount ${amount} exceeds max_single_sms_amount ${settings.max_single_sms_amount}; escalated for cashier review`,
    };
  }
  return { kind: 'ok' };
}

/* ------------------------------------------------------------------------- */
/* RULE 5 — agent daily volume cap (post-credit auto-suspend)                */
/* ------------------------------------------------------------------------- */

export interface AgentVolumeVerdict {
  /** When true, suspend the agent and alert admins. */
  shouldSuspend: boolean;
  totalToday: string;
  capacity: number;
  countToday: number;
}

/**
 * Called AFTER a credit lands. If the running daily volume crosses
 * `max_daily_agent_volume` we recommend suspending the agent device.
 * Callers do the suspension + emit so this function stays read-only
 * and easy to compose into different post-credit hooks.
 */
export async function checkAgentDailyVolumeCap(
  client: PoolClient,
  tenantId: string,
  agentId: string,
  settings: TelebirrSettings,
  now: Date = new Date()
): Promise<AgentVolumeVerdict> {
  const { total, count } = await repo.getAgentDailyVolume(
    client,
    tenantId,
    agentId,
    now
  );
  const totalNum = Number(total);
  return {
    shouldSuspend: totalNum > settings.max_daily_agent_volume,
    totalToday: total,
    capacity: settings.max_daily_agent_volume,
    countToday: count,
  };
}

/**
 * Suspend an agent because it tripped the daily cap. Audited and
 * sessions are closed so the device gets a 401 next call. Idempotent
 * when the agent is already suspended.
 */
export async function suspendAgentForFraud(
  client: PoolClient,
  params: {
    tenantId: string;
    agentId: string;
    reason: string;
    payload: Record<string, unknown>;
  }
): Promise<void> {
  const updated = await repo.setAgentStatus(client, params.agentId, 'suspended');
  if (!updated) return;
  await repo.closeAllOpenAgentSessions(client, params.agentId);
  await tryAudit(
    {
      tenantId: params.tenantId,
      actorId: null,
      actorType: 'system',
      action: 'telebirr.agent.auto_suspend',
      resource: 'telebirr_agent',
      resourceId: params.agentId,
      payload: { reason: params.reason, ...params.payload },
      ip: null,
      userAgent: null,
      status: 'success',
    },
    { bypassRls: true }
  );
  logger.warn(
    { tenantId: params.tenantId, agentId: params.agentId, ...params.payload },
    `telebirr: auto-suspended agent — ${params.reason}`
  );
}

/* ------------------------------------------------------------------------- */
/* RULE 6 — sender phone velocity                                            */
/* ------------------------------------------------------------------------- */

export interface SenderVelocityVerdict {
  /** When true, demote the match to manual review. */
  shouldDemote: boolean;
  recentCount: number;
  windowMinutes: number;
  threshold: number;
}

/**
 * If the same Telebirr-side sender phone has produced more than
 * `sender_phone_velocity_max` transactions in the configurable window,
 * demote the current match to a probable_match (cashier review). This
 * catches "agent device sending the same fake payment 10x in a row"
 * patterns without rejecting legitimate but bursty users outright.
 */
export async function checkSenderPhoneVelocity(
  client: PoolClient,
  tenantId: string,
  senderPhone: string | null,
  settings: TelebirrSettings,
  excludeTelebirrRef: string | null = null
): Promise<SenderVelocityVerdict> {
  if (!senderPhone) {
    return {
      shouldDemote: false,
      recentCount: 0,
      windowMinutes: settings.sender_phone_velocity_window_minutes,
      threshold: settings.sender_phone_velocity_max,
    };
  }
  const recentCount = await repo.getSenderPhoneRecentCount(
    client,
    tenantId,
    senderPhone,
    settings.sender_phone_velocity_window_minutes,
    excludeTelebirrRef
  );
  return {
    shouldDemote: recentCount >= settings.sender_phone_velocity_max,
    recentCount,
    windowMinutes: settings.sender_phone_velocity_window_minutes,
    threshold: settings.sender_phone_velocity_max,
  };
}

/* ------------------------------------------------------------------------- */
/* RULE 7 — telecom sender id allowlist                                      */
/* ------------------------------------------------------------------------- */

export type SenderAllowlistVerdict =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * The real Telebirr SMS sender (the SMSC short code) is one of a
 * known set: "Telebirr", "TELEBIRR", "8978". Anything else means
 * either (a) the agent app is forwarding non-Telebirr SMS by mistake,
 * or (b) someone is trying to feed the platform fabricated SMS via the
 * agent endpoint. Either way we drop without storing as a real
 * Telebirr transaction.
 */
export function validateSenderAllowlist(
  senderId: string | null,
  settings: TelebirrSettings
): SenderAllowlistVerdict {
  if (!senderId) {
    // Defensible default: when the device didn't include a sender id
    // we accept (parser was already strict about Telebirr-shaped body).
    return { ok: true };
  }
  const allowed = new Set(settings.approved_sender_ids.map((s) => s.toUpperCase()));
  if (!allowed.has(senderId.toUpperCase())) {
    return {
      ok: false,
      reason: `sender id "${senderId}" not in approved_sender_ids`,
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------------- */
/* RULE 8 — refcode brute-force                                              */
/* ------------------------------------------------------------------------- */

export interface RefcodeBruteForceVerdict {
  blocked: boolean;
  attemptCount: number;
  threshold: number;
  windowMinutes: number;
}

/**
 * Records a refcode probe (someone proposing or trying a candidate
 * code) and returns whether the identifier should be rate-limited
 * back. Called from:
 *   - /api/user/deposits/telebirr/initiate (every generated code goes
 *     through here so we can trip on automated requesters churning
 *     codes from a single IP),
 *   - any future "look up deposit by code" endpoint.
 */
export async function checkRefcodeBruteForce(
  client: PoolClient,
  params: {
    tenantId: string;
    identifierType: 'ip' | 'user' | 'agent' | 'session';
    identifier: string;
    refcode: string;
    context: string;
    ip: string | null;
    userAgent: string | null;
    settings: TelebirrSettings;
  }
): Promise<RefcodeBruteForceVerdict> {
  const { distinctCount } = await repo.recordRefcodeAttempt(client, {
    tenantId: params.tenantId,
    identifierType: params.identifierType,
    identifier: params.identifier,
    refcode: params.refcode,
    context: params.context,
    ip: params.ip,
    userAgent: params.userAgent,
    windowMinutes: params.settings.refcode_brute_force_window_minutes,
  });
  return {
    blocked: distinctCount > params.settings.refcode_brute_force_max,
    attemptCount: distinctCount,
    threshold: params.settings.refcode_brute_force_max,
    windowMinutes: params.settings.refcode_brute_force_window_minutes,
  };
}

/* ------------------------------------------------------------------------- */
/* Audit helpers                                                             */
/* ------------------------------------------------------------------------- */

/**
 * Centralised emitter for "fraud signal detected" audit events so the
 * admin "Telebirr fraud" tab has one consistent action label to filter
 * by. Best-effort; never throws.
 */
export function auditFraudSignal(params: {
  tenantId: string;
  rule: 'rule3_timestamp' | 'rule4_amount' | 'rule5_volume' |
        'rule6_velocity' | 'rule7_sender' | 'rule8_brute_force';
  resource: string;
  resourceId: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  return tryAudit(
    {
      tenantId: params.tenantId,
      actorId: null,
      actorType: 'system',
      action: `telebirr.fraud.${params.rule}`,
      resource: params.resource,
      resourceId: params.resourceId,
      payload: params.payload,
      ip: params.ip,
      userAgent: params.userAgent,
      status: 'failure',
    },
    { bypassRls: true }
  );
}
