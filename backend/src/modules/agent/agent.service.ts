import crypto from 'crypto';
import bcrypt from 'bcrypt';

import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { logger } from '../../infrastructure/logger';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../../http/errors/http-error';
import { tryAudit } from '../audit/audit.service';
import {
  parseSms,
  matchPayment,
  confirmManualMatch,
  type ParsedSms,
  type MatchPaymentResult,
} from '../telebirr';
import {
  auditFraudSignal,
  validateSenderAllowlist,
  validateSmsTimestamp,
} from '../telebirr/telebirr.fraud';
import { loadTelebirrSettings } from '../telebirr/telebirr.settings';
import * as telebirrRepo from '../telebirr/telebirr.repository';

import * as repo from './agent.repository';
import {
  signAgentToken,
  verifyAgentToken,
  type IssuedAgentToken,
} from './agent.tokens';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  parseTelebirrSms,
  isTelebirrSender,
  computeDedupHash: computePromptDedupHash,
} = require('../../services/smsParser');

/* ------------------------------------------------------------------------- */
/* Login                                                                     */
/* ------------------------------------------------------------------------- */

export interface AgentLoginInput {
  telebirrNumber: string;
  password: string;
  deviceId: string;
  deviceName: string | null;
  appVersion: string | null;
  ip: string | null;
  userAgent: string | null;
  /**
   * Optional tenant id resolved by middleware (header / subdomain). When
   * present we narrow the lookup; when absent we accept any tenant so
   * the device app can resolve tenant from the agent record itself.
   */
  tenantHint: string | null;
}

export interface AgentTenantSummary {
  id: string;
  name: string | null;
  slug: string | null;
}

export interface AgentConfig {
  /**
   * Heartbeat cadence in seconds. The Flutter app uses this to schedule
   * `/api/agent/auth/heartbeat`. Centralising it here lets us change
   * cadence per tenant later without an app update.
   */
  heartbeatIntervalSec: number;
  /** Max SMS body size we accept on /sms/report. Mirrors the DTO cap. */
  maxSmsBodyBytes: number;
  /** Max messages per /sms/batch call. Mirrors the DTO cap. */
  maxBatchSize: number;
  /** Currency the agent's tenant operates in. */
  currency: string;
  /** ISO of when the issued access token expires (mirrors top-level field). */
  tokenExpiresAt: string;
}

export interface AgentLoginResult {
  token: string;
  tokenExpiresAt: string;
  agentId: string;
  agentName: string;
  telebirrNumber: string;
  deviceToken: string | null;
  deviceRecordId: string | null;
  autostart: boolean;
  tenant: AgentTenantSummary;
  config: AgentConfig;
}

const HEARTBEAT_INTERVAL_SEC = 60;
const MAX_SMS_BODY_BYTES = 4096;
const MAX_BATCH_SIZE = 200;

export async function login(
  input: AgentLoginInput
): Promise<AgentLoginResult> {
  // Cross-tenant lookup uses bypass-RLS because the device only knows
  // its Telebirr number, not the tenant it belongs to. The agent row's
  // `tenant_id` becomes the active tenant from this point on.
  const found = await withTenantClient(
    { tenantId: null, bypassRls: true },
    async (client) =>
      repo.findAgentByTelebirrNumberCrossTenant(
        client,
        input.telebirrNumber,
        input.tenantHint
      )
  );

  if (!found) {
    // Constant-time bcrypt comparison against a dummy hash so wrong
    // telebirr numbers and wrong passwords look the same on the wire.
    await bcrypt.compare(input.password, getDummyHash());
    await audit({
      tenantId: input.tenantHint,
      actorId: null,
      actorType: 'anonymous',
      action: 'agent.login',
      resource: 'telebirr_agent',
      resourceId: null,
      payload: {
        reason: 'agent_not_found',
        telebirr_number: input.telebirrNumber,
        device_id: input.deviceId,
      },
      ip: input.ip,
      userAgent: input.userAgent,
      status: 'failure',
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  if (found.status !== 'active') {
    await audit({
      tenantId: found.tenant_id,
      actorId: found.id,
      actorType: 'telebirr_agent',
      action: 'agent.login',
      resource: 'telebirr_agent',
      resourceId: found.id,
      payload: {
        reason: 'agent_inactive',
        agent_status: found.status,
        device_id: input.deviceId,
      },
      ip: input.ip,
      userAgent: input.userAgent,
      status: 'failure',
    });
    throw new ForbiddenError(`Agent is ${found.status}`, {
      reason: 'agent_suspended',
      agent_status: found.status,
    });
  }

  if (!found.auth_token_hash) {
    // The admin created the row but never set a password. Fail safely.
    await bcrypt.compare(input.password, getDummyHash());
    await audit({
      tenantId: found.tenant_id,
      actorId: found.id,
      actorType: 'telebirr_agent',
      action: 'agent.login',
      resource: 'telebirr_agent',
      resourceId: found.id,
      payload: { reason: 'no_password_set', device_id: input.deviceId },
      ip: input.ip,
      userAgent: input.userAgent,
      status: 'failure',
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  const passwordOk = await bcrypt.compare(
    input.password,
    found.auth_token_hash
  );
  if (!passwordOk) {
    await audit({
      tenantId: found.tenant_id,
      actorId: found.id,
      actorType: 'telebirr_agent',
      action: 'agent.login',
      resource: 'telebirr_agent',
      resourceId: found.id,
      payload: { reason: 'invalid_password', device_id: input.deviceId },
      ip: input.ip,
      userAgent: input.userAgent,
      status: 'failure',
    });
    throw new UnauthorizedError('Invalid credentials');
  }

  // Device pairing. The operator-typed password is the pairing secret; the
  // `device_id` merely *binds* the account to one physical device after the
  // first successful login. Two cases:
  //
  //   1. First-login pairing — the agent was created by an admin (or seed)
  //      but never bound to a real device, so its stored `device_id` is
  //      still a placeholder. We adopt the device that just authenticated.
  //      Without this, an admin-registered agent could NEVER sign in from a
  //      real phone, because the app generates its own per-install UUID.
  //   2. Strict re-pairing — the agent is already bound to a real device.
  //      A different device is refused; moving an agent to a new phone stays
  //      an explicit admin action.
  let shouldAdoptDevice = false;
  if (found.device_id !== input.deviceId) {
    if (isUnpairedPlaceholderDevice(found.device_id)) {
      shouldAdoptDevice = true;
    } else {
      await audit({
        tenantId: found.tenant_id,
        actorId: found.id,
        actorType: 'telebirr_agent',
        action: 'agent.login',
        resource: 'telebirr_agent',
        resourceId: found.id,
        payload: {
          reason: 'device_not_paired',
          agent_device_id: found.device_id,
          attempted_device_id: input.deviceId,
        },
        ip: input.ip,
        userAgent: input.userAgent,
        status: 'failure',
      });
      throw new UnauthorizedError(
        'This device is not paired with the agent number',
        { reason: 'device_not_paired' }
      );
    }
  }

  // Successful login: open a session, refresh metadata.
  const session = await withTenantClient(
    { tenantId: found.tenant_id },
    async (client) => {
      // First-login pairing: bind the agent to this device before issuing
      // the token so the `did` claim matches on subsequent refreshes.
      if (shouldAdoptDevice) {
        await repo.adoptAgentDevice(
          client,
          found.id,
          input.deviceId,
          input.deviceName
        );
        found.device_id = input.deviceId;
      }
      const sess = await repo.insertAgentSession(client, {
        tenantId: found.tenant_id,
        agentId: found.id,
        deviceFingerprint: input.deviceId,
        ipAddress: input.ip,
      });
      await repo.updateAgentLoginMeta(client, found.id, {
        deviceName: input.deviceName,
        appVersion: input.appVersion,
        lastSeenAt: new Date(),
      });
      // Provision the companion `p2p_devices` row keyed by the agent id.
      // The SMS/deposit pipeline (`p2p_sms_logs.device_id`,
      // `p2p_deposits.device_id`) has FKs to `p2p_devices(id)`, but the
      // mobile app authenticates as a `telebirr_agents` row. Without this
      // row, `reportSmsBatch` fails the FK and the manual-deposit queue
      // never receives the SMS. Idempotent: only inserts if missing.
      await client.query(
        `INSERT INTO p2p_devices
           (id, tenant_id, label, telebirr_phone, device_token, status, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, 'online', now())
         ON CONFLICT (id) DO UPDATE
           SET last_seen_at = now(),
               status = 'online'`,
        [
          found.id,
          found.tenant_id,
          found.agent_name ?? `Agent ${found.telebirr_number}`,
          found.telebirr_number,
          found.device_id ?? found.id,
        ]
      );
      return sess;
    }
  );

  const issued = signAgentToken({
    aid: found.id,
    tid: found.tenant_id,
    did: found.device_id,
    sid: session.id,
  });

  const tenant = await fetchTenantSummary(found.tenant_id);
  const currency = await fetchTenantCurrency(found.tenant_id);

  await audit({
    tenantId: found.tenant_id,
    actorId: found.id,
    actorType: 'telebirr_agent',
    action: 'agent.login',
    resource: 'telebirr_agent',
    resourceId: found.id,
    payload: {
      session_id: session.id,
      device_id: found.device_id,
      device_name: input.deviceName,
      app_version: input.appVersion,
      token_jti: issued.jti,
      token_expires_at: issued.expiresAt.toISOString(),
    },
    ip: input.ip,
    userAgent: input.userAgent,
    status: 'success',
  });

  return formatLoginResponse(found, tenant, currency, issued);
}

/* ------------------------------------------------------------------------- */
/* Refresh                                                                   */
/* ------------------------------------------------------------------------- */

export interface AgentRefreshResult {
  token: string;
  tokenExpiresAt: string;
}

export async function refresh(
  presentedToken: string,
  ip: string | null,
  userAgent: string | null
): Promise<AgentRefreshResult> {
  let claims: ReturnType<typeof verifyAgentToken>;
  try {
    claims = verifyAgentToken(presentedToken);
  } catch (err) {
    const name = (err as { name?: string } | null)?.name;
    throw name === 'TokenExpiredError'
      ? new UnauthorizedError('Agent token expired', { reason: 'token_expired' })
      : new UnauthorizedError('Invalid agent token', { reason: 'token_invalid' });
  }

  const decision = await withTenantClient(
    { tenantId: claims.tid, bypassRls: true },
    async (client) => {
      const agent = await repo.findAgentById(client, claims.aid);
      if (!agent) {
        throw new UnauthorizedError('Agent not found', {
          reason: 'agent_not_found',
        });
      }
      if (agent.status !== 'active') {
        throw new ForbiddenError(`Agent is ${agent.status}`, {
          reason: 'agent_suspended',
          agent_status: agent.status,
        });
      }
      if (agent.device_id !== claims.did) {
        throw new UnauthorizedError(
          'Device id on token does not match paired device',
          { reason: 'device_changed' }
        );
      }
      const session = await repo.findOpenSession(
        client,
        agent.id,
        claims.sid
      );
      if (!session) {
        throw new UnauthorizedError('Session is closed', {
          reason: 'session_closed',
        });
      }
      await repo.bumpSessionActivity(client, session.id, new Date());
      return { agent, session };
    }
  );

  const issued = signAgentToken({
    aid: decision.agent.id,
    tid: decision.agent.tenant_id,
    did: decision.agent.device_id,
    sid: decision.session.id,
  });

  await audit({
    tenantId: decision.agent.tenant_id,
    actorId: decision.agent.id,
    actorType: 'telebirr_agent',
    action: 'agent.refresh',
    resource: 'telebirr_agent_session',
    resourceId: decision.session.id,
    payload: {
      token_jti: issued.jti,
      token_expires_at: issued.expiresAt.toISOString(),
    },
    ip,
    userAgent,
    status: 'success',
  });

  return {
    token: issued.token,
    tokenExpiresAt: issued.expiresAt.toISOString(),
  };
}

/* ------------------------------------------------------------------------- */
/* Heartbeat                                                                 */
/* ------------------------------------------------------------------------- */

export interface HeartbeatResult {
  ok: true;
  pendingRequests: number;
  commands: Array<{ id: string; command_type: string; payload: Record<string, unknown> }>;
  serverTime: string;
}

export async function heartbeat(
  agentId: string,
  tenantId: string,
  appVersion: string | null,
  deviceStatus?: {
    batteryPct?: number;
    signalStrength?: number;
    status?: 'online' | 'offline' | 'maintenance';
  }
): Promise<HeartbeatResult> {
  const heartbeatData = await withTenantClient({ tenantId, bypassRls: true }, async (client) => {
    if (appVersion) {
      await client.query(
        `UPDATE telebirr_agents SET app_version = $2 WHERE id = $1`,
        [agentId, appVersion]
      );
    }
    const pending = await repo.countTenantPendingTelebirr(client, tenantId);
    const cmdRows = await client.query<{
      id: string;
      command_type: string;
      payload: Record<string, unknown> | null;
    }>(
      `SELECT id,
              COALESCE(command_type, kind, 'check_balance') AS command_type,
              payload
         FROM p2p_commands
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 20`
    );
    return {
      pending,
      commands: cmdRows.rows.map((r) => ({
        id: r.id,
        command_type: r.command_type,
        payload: r.payload ?? {},
      })),
    };
  });

  // Prompt-2 compatibility: if the authenticated identity is a p2p device id,
  // persist heartbeat metrics to p2p_devices too.
  await withTenantClient({ tenantId: null, bypassRls: true }, async (client) => {
    await client.query(
      `UPDATE p2p_devices
          SET battery_pct = COALESCE($2, battery_pct),
              signal_strength = COALESCE($3, signal_strength),
              status = COALESCE($4, status),
              last_seen_at = now()
        WHERE id = $1`,
      [
        agentId,
        deviceStatus?.batteryPct ?? null,
        deviceStatus?.signalStrength ?? null,
        deviceStatus?.status ?? null,
      ]
    );
  });

  return {
    ok: true,
    pendingRequests: heartbeatData.pending,
    commands: heartbeatData.commands,
    serverTime: new Date().toISOString(),
  };
}

/* ------------------------------------------------------------------------- */
/* SMS report (single + batch)                                               */
/* ------------------------------------------------------------------------- */

export interface SmsReportResult {
  received: true;
  smsId: string;
  duplicate: boolean;
}

export async function reportSms(
  agentId: string,
  tenantId: string,
  input: {
    smsBody: string;
    senderNumber: string | null;
    receivedAt: Date | null;
    /** Device wall-clock; logged but not used for matching. */
    deviceTimestamp: Date | null;
  }
): Promise<SmsReportResult> {
  // Single-message endpoint policy: store every SMS even if a "looks
  // duplicate" body arrives. We only dedupe by Telebirr ref (in the
  // matcher) — never by raw body — because operators legitimately
  // receive identical SMS bodies for, e.g., two separate ETB 100
  // payments at the same minute.
  //
  // Pre-storage fraud guards (RULE 3, RULE 7) decide whether the SMS
  // gets auto-processed. Even rejected SMS get persisted so the
  // append-only audit trail never has a gap.
  const { row, processed } = await withTenantClient(
    { tenantId },
    async (client) => {
      const settings = await loadTelebirrSettings(client, tenantId);
      const { reject, reason, rule } = preIngestionFraudCheck(input, settings);

      const ins = await repo.insertSmsRaw(client, {
        tenantId,
        agentId,
        smsBody: input.smsBody,
        senderNumber: input.senderNumber,
        receivedAt: input.receivedAt,
        dedupHash: null,
      });

      if (reject) {
        // Mark as processed so the (eventual) replay worker doesn't
        // try this row again. We deliberately do NOT schedule the
        // matcher for it.
        await telebirrRepo.markSmsProcessed(client, ins.row.id);
      }

      return { row: ins.row, processed: !reject, rejectReason: reason, rejectRule: rule };
    }
  );

  if (!processed) {
    // Audit outside the DB transaction (best-effort, never blocks).
    await audit({
      tenantId,
      actorId: agentId,
      actorType: 'telebirr_agent',
      action: 'agent.sms.rejected',
      resource: 'telebirr_sms_raw',
      resourceId: row.id,
      payload: {
        sender_number: input.senderNumber,
        received_at: input.receivedAt?.toISOString() ?? null,
        device_timestamp: input.deviceTimestamp?.toISOString() ?? null,
        body_length: input.smsBody.length,
      },
      ip: null,
      userAgent: null,
      status: 'failure',
    });
    return { received: true, smsId: row.id, duplicate: false };
  }

  scheduleProcessing(agentId, tenantId, row.id, input.smsBody);
  return { received: true, smsId: row.id, duplicate: false };
}

export interface SmsBatchResult {
  received: number;
  duplicates: number;
  deposits_created: number;
}

export async function reportSmsBatch(
  agentId: string,
  tenantId: string,
  messages: Array<{
    smsBody: string;
    senderNumber: string | null;
    receivedAt: Date | null;
    deviceTimestamp: Date | null;
    dedupHash?: string | null;
  }>
): Promise<SmsBatchResult> {
  let received = 0;
  let duplicates = 0;
  let depositsCreated = 0;

  await withTenantClient({ tenantId, bypassRls: true }, async (client) => {
    const deviceId = agentId;

    for (const m of messages) {
      const receivedAtIso = m.receivedAt
        ? m.receivedAt.toISOString()
        : new Date().toISOString();
      const hash =
        m.dedupHash ??
        computePromptDedupHash(m.smsBody, receivedAtIso, m.senderNumber ?? '');

      const existingSms = await client.query<{ id: string }>(
        `SELECT id FROM p2p_sms_logs WHERE dedup_hash = $1 LIMIT 1`,
        [hash]
      );
      if (existingSms.rows[0]) {
        duplicates += 1;
        continue;
      }

      received += 1;

      const insertedSms = await client.query<{ id: string }>(
        `INSERT INTO p2p_sms_logs
           (device_id, sender, body, received_at, dedup_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [deviceId, m.senderNumber, m.smsBody, receivedAtIso, hash]
      );
      const smsLogId = insertedSms.rows[0].id;

      if (!isTelebirrSender(m.senderNumber ?? '')) {
        continue;
      }

      const parsed = parseTelebirrSms(m.smsBody);
      await client.query(
        `UPDATE p2p_sms_logs
            SET parsed = $2,
                parse_result = $3::jsonb
          WHERE id = $1`,
        [smsLogId, parsed.parsed === true, JSON.stringify(parsed)]
      );

      if (!parsed.parsed) {
        continue;
      }

      const dupDeposit = await client.query<{ id: string }>(
        `SELECT id FROM p2p_deposits WHERE telebirr_ref = $1 LIMIT 1`,
        [parsed.telebirr_ref]
      );
      if (dupDeposit.rows[0]) {
        continue;
      }

      await client.query(
        `INSERT INTO p2p_deposits
          (sms_log_id, device_id, tenant_id, amount, sender_name, sender_phone, telebirr_ref, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
        [
          smsLogId,
          deviceId,
          tenantId,
          parsed.amount,
          parsed.sender_name,
          parsed.sender_phone,
          parsed.telebirr_ref,
        ]
      );
      depositsCreated += 1;

      // Keep current real-time compatibility event expected by admin listeners.
      const { emitToAdmins } = await import('../../realtime/socket');
      emitToAdmins(tenantId, 'p2p:new_deposit', {
        amount: parsed.amount,
        sender_name: parsed.sender_name,
        sender_phone: parsed.sender_phone,
        telebirr_ref: parsed.telebirr_ref,
        device_id: deviceId,
      });
    }
  });

  // ── Telebirr matching pass ───────────────────────────────────────────────
  // Route every Telebirr-sender SMS through the SAME matcher the single
  // /sms/report endpoint uses, so reference-based user deposit requests
  // (telebirr_deposit_requests, Strategy 0) auto-credit from batches too.
  // Runs in its OWN per-message transaction so a failure here can never
  // poison the legacy p2p writes above, and is idempotent via the
  // telebirr_sms_raw dedup index (re-scanning the inbox is cheap).
  for (const m of messages) {
    if (!isTelebirrSender(m.senderNumber ?? '')) continue;
    try {
      const rawReceivedIso = m.receivedAt
        ? m.receivedAt.toISOString()
        : new Date().toISOString();
      const rawHash =
        m.dedupHash ??
        computePromptDedupHash(m.smsBody, rawReceivedIso, m.senderNumber ?? '');

      const scheduled = await withTenantClient(
        { tenantId, bypassRls: true },
        async (client) => {
          const settings = await loadTelebirrSettings(client, tenantId);
          const insRaw = await repo.insertSmsRaw(client, {
            tenantId,
            agentId,
            smsBody: m.smsBody,
            senderNumber: m.senderNumber,
            receivedAt: m.receivedAt,
            dedupHash: rawHash,
          });
          if (!insRaw.created) return null;
          const guard = preIngestionFraudCheck(m, settings);
          if (guard.reject) {
            await telebirrRepo.markSmsProcessed(client, insRaw.row.id);
            return null;
          }
          return insRaw.row.id;
        }
      );

      if (scheduled) {
        scheduleProcessing(agentId, tenantId, scheduled, m.smsBody);
      }
    } catch (err) {
      logger.warn(
        { err, agentId, tenantId },
        'telebirr: batch matching pass failed for one message'
      );
    }
  }

  return { received, duplicates, deposits_created: depositsCreated };
}

/**
 * RULE 3 + RULE 7 — pre-ingestion guards. Pure: no DB calls, no
 * audits. Caller decides whether to skip processing and emit a fraud
 * audit event on rejection.
 */
function preIngestionFraudCheck(
  m: {
    smsBody: string;
    senderNumber: string | null;
    receivedAt: Date | null;
  },
  settings: import('../telebirr/telebirr.settings').TelebirrSettings
): {
  reject: boolean;
  reason: string | null;
  rule: 'rule3_timestamp' | 'rule7_sender' | null;
} {
  const sender = validateSenderAllowlist(m.senderNumber, settings);
  if (!sender.ok) {
    return { reject: true, reason: sender.reason, rule: 'rule7_sender' };
  }
  const ts = validateSmsTimestamp(m.receivedAt, settings);
  if (!ts.ok) {
    return { reject: true, reason: ts.reason, rule: 'rule3_timestamp' };
  }
  return { reject: false, reason: null, rule: null };
}

/* ------------------------------------------------------------------------- */
/* Status / dashboard                                                        */
/* ------------------------------------------------------------------------- */

export interface AgentStatus {
  agent: {
    id: string;
    name: string;
    telebirr_number: string;
    status: string;
    balance: string;
    last_seen_at: string | null;
    device_name: string | null;
    app_version: string | null;
  };
  /**
   * Wallet snapshot mirroring the Admin Panel "Wallet Devices" card so the
   * agent app and admin display identical figures. All values are decimal
   * strings; `commission_rate` is a percentage (e.g. "2.5").
   */
  wallet: {
    balance: string;
    commission_rate: string;
    pre_deposit: string;
    total_capacity: string;
    available_capacity: string;
  };
  today: {
    transaction_count: number;
    total_amount_credited: string;
    pending_count: number;
    unmatched_count: number;
  };
  pending_total: number;
  server_time: string;
}

export async function getStatus(
  agentId: string,
  tenantId: string
): Promise<AgentStatus> {
  return withTenantClient({ tenantId }, async (client) => {
    const agent = await repo.findAgentById(client, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    const today = await repo.aggregateAgentToday(client, tenantId, agentId);
    const pending = await repo.countTenantPendingTelebirr(client, tenantId);

    // Wallet figures identical to the admin "Wallet Devices" card:
    //   pre_deposit      = net of confirmed swaps (fallback to stored balance)
    //   total_capacity   = pre_deposit * (1 + commission%)
    //   available_capacity = total_capacity (matches the admin card)
    // Read-only; any failure degrades to balance-based values so the status
    // poll the app relies on is never broken.
    const balanceNum = Number(agent.balance) || 0;
    let wallet = {
      balance: agent.balance,
      commission_rate: '2.5',
      pre_deposit: String(Math.round(balanceNum)),
      total_capacity: '0',
      available_capacity: '0',
    };
    try {
      const swapRes = await client.query<{ pre_deposit: string | null }>(
        `SELECT SUM(CASE WHEN source = 'manual'     AND status = 'added' THEN amount
                         WHEN source = 'withdrawal' AND status = 'added' THEN -amount
                         ELSE 0 END)::text AS pre_deposit
           FROM p2p_swaps
          WHERE agent_id = $1 AND tenant_id = $2`,
        [agentId, tenantId]
      );
      const preDeposit =
        swapRes.rows[0]?.pre_deposit != null
          ? Number(swapRes.rows[0].pre_deposit)
          : balanceNum;

      const commRes = await client.query<{ deposit_pct: string | null }>(
        `SELECT deposit_pct::text AS deposit_pct
           FROM p2p_commissions
          WHERE agent_id = $1 AND tenant_id = $2
          LIMIT 1`,
        [agentId, tenantId]
      );
      let commission =
        commRes.rows[0]?.deposit_pct != null
          ? Number(commRes.rows[0].deposit_pct)
          : NaN;
      if (!Number.isFinite(commission)) {
        const setRes = await client.query<{ default_pct: string | null }>(
          `SELECT default_deposit_commission_pct::text AS default_pct
             FROM p2p_settings WHERE tenant_id = $1 LIMIT 1`,
          [tenantId]
        );
        commission =
          setRes.rows[0]?.default_pct != null
            ? Number(setRes.rows[0].default_pct)
            : 2.5;
      }
      if (!Number.isFinite(commission)) commission = 2.5;

      const totalCapacity = Math.round(preDeposit * (1 + commission / 100));
      wallet = {
        balance: agent.balance,
        commission_rate: String(commission),
        pre_deposit: String(Math.round(preDeposit)),
        total_capacity: String(totalCapacity),
        available_capacity: String(totalCapacity),
      };
    } catch {
      /* keep balance-based fallback */
    }

    return {
      agent: {
        id: agent.id,
        name: agent.agent_name,
        telebirr_number: agent.telebirr_number,
        status: agent.status,
        balance: agent.balance,
        last_seen_at: agent.last_seen_at?.toISOString() ?? null,
        device_name: agent.device_name,
        app_version: agent.app_version,
      },
      wallet,
      today,
      pending_total: pending,
      server_time: new Date().toISOString(),
    };
  });
}

/* ------------------------------------------------------------------------- */
/* Manual confirm                                                            */
/* ------------------------------------------------------------------------- */

export interface ConfirmResult {
  outcome: 'credited' | 'duplicate' | 'rejected';
  reason: string;
  telebirr_transaction_id: string;
  credit_transaction_id: string | null;
  user_id: string;
}

export async function confirmTransaction(
  agentId: string,
  tenantId: string,
  telebirrRef: string,
  userId: string,
  ip: string | null,
  userAgent: string | null
): Promise<ConfirmResult> {
  const out = await confirmManualMatch(tenantId, telebirrRef, userId, {
    actorType: 'telebirr_agent',
    actorId: agentId,
    ip,
    userAgent,
  });
  if (out.outcome === 'rejected') {
    throw new BadRequestError(out.reason, {
      reason: 'manual_confirm_rejected',
    });
  }
  return {
    outcome: out.outcome,
    reason: out.reason,
    telebirr_transaction_id: out.telebirrTransactionId,
    credit_transaction_id: out.creditTransactionId,
    user_id: out.matchedUserId,
  };
}

/* ------------------------------------------------------------------------- */
/* Internals                                                                 */
/* ------------------------------------------------------------------------- */

/**
 * Compute a stable hash for a batch SMS so the partial unique index on
 * `(tenant_id, agent_id, dedup_hash)` can detect resends. We include
 * the agent id so two devices reporting the same body don't collide,
 * normalize whitespace in the body so trivial display differences
 * don't bypass dedup, and round receivedAt to the second so clock
 * jitter doesn't produce different hashes.
 */
function computeDedupHash(
  agentId: string,
  body: string,
  receivedAt: Date | null
): string {
  const normBody = body.trim().replace(/\s+/g, ' ');
  const normTs = receivedAt
    ? Math.floor(receivedAt.getTime() / 1000).toString()
    : '';
  const h = crypto.createHash('sha256');
  h.update(agentId);
  h.update('|');
  h.update(normBody);
  h.update('|');
  h.update(normTs);
  return h.digest('hex');
}

/**
 * Schedule SMS parse + match in the background. The HTTP response is
 * already committed by the time this runs, so the device never waits
 * on the matcher and never sees a 5xx from a transient match failure.
 *
 * Production should swap this for a durable queue (BullMQ/Redis) so
 * matching survives a process crash. Until then, an unprocessed row
 * stays in `telebirr_sms_raw.processed = false` and a future worker
 * can replay it from the table.
 */
function scheduleProcessing(
  agentId: string,
  tenantId: string,
  smsRawId: string,
  smsBody: string
): void {
  setImmediate(async () => {
    try {
      const parsed: ParsedSms = parseSms(smsBody);
      const result: MatchPaymentResult = await matchPayment(parsed, {
        agentId,
        tenantId,
        smsRawId,
      });
      logger.info(
        {
          agentId,
          tenantId,
          smsRawId,
          outcome: result.outcome,
          strategy: result.strategy,
          telebirr_ref: parsed.telebirrRef,
        },
        'telebirr: sms processing complete'
      );
    } catch (err) {
      logger.error(
        { err, agentId, tenantId, smsRawId },
        'telebirr: background sms processing failed'
      );
    }
  });
}

interface AuditEvent {
  tenantId: string | null;
  actorId: string | null;
  actorType: string;
  action: string;
  resource: string;
  resourceId: string | null;
  payload: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  status: 'success' | 'failure' | 'warning' | 'info';
}

async function audit(event: AuditEvent): Promise<void> {
  await tryAudit(event, { bypassRls: true });
}

/**
 * True when an agent's stored `device_id` is a placeholder that was never
 * bound to a real device — either the admin-registration default
 * (`dev_<uuid>`, see admin p2p `registerWalletDevice`) or an empty value.
 * Such agents adopt the first device that authenticates with the correct
 * password. Anything else is treated as an already-paired device and kept
 * under strict pairing.
 */
function isUnpairedPlaceholderDevice(deviceId: string | null): boolean {
  if (!deviceId) return true;
  const v = deviceId.trim();
  if (v === '') return true;
  return v.startsWith('dev_');
}

/* Cached dummy bcrypt hash used to keep response time constant on
 * agent-not-found. Generated lazily on first miss; the actual value
 * doesn't matter as long as it's a valid bcrypt hash. */
let cachedDummyHash: string | null = null;
function getDummyHash(): string {
  if (!cachedDummyHash) {
    // bcrypt of "x" with 10 rounds — fixed string so we don't need a
    // synchronous hash on startup.
    cachedDummyHash =
      '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.5z7g/HsxJ3xR5R2xtYSsT7XU3o72';
  }
  return cachedDummyHash;
}

async function fetchTenantSummary(
  tenantId: string
): Promise<AgentTenantSummary> {
  return withTenantClient(
    { tenantId, bypassRls: true },
    async (client) => {
      const r = await client.query<{
        id: string;
        name: string | null;
        slug: string | null;
      }>(
        `SELECT id, name, slug::text AS slug
           FROM tenants
          WHERE id = $1
          LIMIT 1`,
        [tenantId]
      );
      const row = r.rows[0];
      if (!row) return { id: tenantId, name: null, slug: null };
      return { id: row.id, name: row.name, slug: row.slug };
    }
  );
}

async function fetchTenantCurrency(tenantId: string): Promise<string> {
  return withTenantClient({ tenantId }, async (client) => {
    const r = await client.query<{ value: { currency?: string } | null }>(
      `SELECT value FROM settings WHERE tenant_id = $1 AND key = 'general' LIMIT 1`,
      [tenantId]
    );
    return r.rows[0]?.value?.currency ?? 'ETB';
  });
}

function formatLoginResponse(
  agent: repo.AgentRow,
  tenant: AgentTenantSummary,
  currency: string,
  issued: IssuedAgentToken
): AgentLoginResult {
  const deviceToken = agent.device_id ?? null;
  return {
    token: issued.token,
    tokenExpiresAt: issued.expiresAt.toISOString(),
    agentId: agent.id,
    agentName: agent.agent_name,
    telebirrNumber: agent.telebirr_number,
    deviceToken,
    deviceRecordId: null,
    autostart: false,
    tenant,
    config: {
      heartbeatIntervalSec: HEARTBEAT_INTERVAL_SEC,
      maxSmsBodyBytes: MAX_SMS_BODY_BYTES,
      maxBatchSize: MAX_BATCH_SIZE,
      currency,
      tokenExpiresAt: issued.expiresAt.toISOString(),
    },
  };
}
