import { z } from 'zod';

/* ------------------------------------------------------------------------- */
/* Auth                                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Telebirr numbers in Ethiopia are 10 digits starting with 09 or 07.
 * We accept either, plus the international forms; canonicalisation is
 * the SMS parser's job, but the login schema enforces a sane shape.
 */
const TELEBIRR_NUMBER = z
  .string()
  .trim()
  .min(9)
  .max(15)
  .regex(/^(?:\+?2510?|0)?[79]\d{8}$/, 'invalid telebirr number');

const DEVICE_ID = z.string().trim().min(4).max(128);
const DEVICE_NAME = z.string().trim().min(1).max(128).optional();
const APP_VERSION = z.string().trim().min(1).max(32).optional();

export const agentLoginSchema = z.object({
  telebirrNumber: TELEBIRR_NUMBER.optional(),
  telebirr_phone: TELEBIRR_NUMBER.optional(),
  password: z.string().min(6).max(256),
  deviceId: DEVICE_ID.optional(),
  device_id: DEVICE_ID.optional(),
  device_token: z.string().trim().min(4).max(255).optional(),
  deviceName: DEVICE_NAME,
  device_name: DEVICE_NAME,
  appVersion: APP_VERSION,
  app_version: APP_VERSION,
});
export type AgentLoginInput = z.infer<typeof agentLoginSchema>;

export const agentRefreshSchema = z.object({
  /**
   * The currently-held agent token. We rotate by issuing a new token
   * with a fresh exp, keeping the same session id.
   */
  token: z.string().min(20),
});
export type AgentRefreshInput = z.infer<typeof agentRefreshSchema>;

export const agentHeartbeatSchema = z.object({
  /**
   * The spec asks for `agentId` in the body. The middleware already
   * resolves the authenticated agent, so this is informational only —
   * we cross-check it against the JWT claim and reject mismatches.
   */
  agentId: z.string().uuid().optional(),
  appVersion: APP_VERSION,
  battery_pct: z.number().int().min(0).max(100).optional(),
  signal_strength: z.number().int().min(0).max(100).optional(),
  status: z.enum(['online', 'offline', 'maintenance']).optional(),
  deviceStatus: z
    .object({
      battery_level: z.number().min(0).max(100).optional(),
      sim_balance: z.number().nonnegative().optional(),
      network: z.string().max(32).optional(),
      online: z.boolean().optional(),
    })
    .partial()
    .optional(),
});
export type AgentHeartbeatInput = z.infer<typeof agentHeartbeatSchema>;

/* ------------------------------------------------------------------------- */
/* SMS reporting                                                             */
/* ------------------------------------------------------------------------- */

/**
 * SMS bodies can be longer than typical (concatenated multi-part
 * messages, custom Ethio Telecom additions). 4 KB is generous and
 * still cheap; reject anything beyond as obviously not Telebirr.
 */
const SMS_BODY = z.string().min(1).max(4096);
const SENDER_NUMBER = z.string().trim().min(1).max(64).optional();
const ISO_DATE_OPTIONAL = z
  .union([
    z.string().datetime({ offset: true }),
    z.string().datetime(),
  ])
  .optional()
  .nullable();

export const agentSmsReportSchema = z.object({
  smsBody: SMS_BODY,
  senderNumber: SENDER_NUMBER,
  receivedAt: ISO_DATE_OPTIONAL,
  /**
   * Device wall-clock at the time the SMS was observed; logged for
   * forensics, not used for matching (Telebirr's own ref is the
   * dedup key).
   */
  deviceTimestamp: ISO_DATE_OPTIONAL,
});
export type AgentSmsReportInput = z.infer<typeof agentSmsReportSchema>;

/**
 * Batch upload — used after the device has been offline. We cap the
 * batch size so a single request cannot stall the matching pipeline.
 */
export const agentSmsBatchSchema = z.object({
  messages: z
    .array(
      z.union([
        z.object({
          smsBody: SMS_BODY,
          senderNumber: SENDER_NUMBER,
          receivedAt: ISO_DATE_OPTIONAL,
          deviceTimestamp: ISO_DATE_OPTIONAL,
        }),
        z.object({
          body: SMS_BODY,
          sender: SENDER_NUMBER,
          received_at: z.union([
            z.string().datetime({ offset: true }),
            z.string().datetime(),
          ]),
          dedup_hash: z.string().trim().length(64).optional(),
        }),
      ])
    )
    .min(1)
    .max(200),
});
export type AgentSmsBatchInput = z.infer<typeof agentSmsBatchSchema>;

/* ------------------------------------------------------------------------- */
/* Manual confirmation                                                       */
/* ------------------------------------------------------------------------- */

export const agentConfirmTransactionSchema = z.object({
  userId: z.string().uuid(),
});
export type AgentConfirmTransactionInput = z.infer<
  typeof agentConfirmTransactionSchema
>;

/**
 * Telebirr ref path-param schema. Allow letters + digits, trim
 * whitespace; anything else is a 400 before we hit the DB.
 */
export const telebirrRefParamSchema = z.object({
  telebirrRef: z
    .string()
    .trim()
    .min(4)
    .max(64)
    .regex(/^[A-Za-z0-9-]+$/),
});
