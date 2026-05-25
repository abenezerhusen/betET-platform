import { z } from 'zod';

/* ------------------------------------------------------------------------- */
/* Device registration                                                       */
/* ------------------------------------------------------------------------- */

export const PLATFORMS = ['ios', 'android', 'web', 'huawei', 'windows'] as const;

export const registerDeviceSchema = z.object({
  device_token: z.string().trim().min(8).max(4096),
  platform: z.enum(PLATFORMS),
  app_version: z.string().trim().max(50).optional(),
  device_model: z.string().trim().max(100).optional(),
});

export const deviceIdParamSchema = z.object({
  id: z.string().uuid(),
});

/* ------------------------------------------------------------------------- */
/* Push send (admin)                                                         */
/* ------------------------------------------------------------------------- */

export const PUSH_SEGMENTS = [
  'all_active',
  'kyc_verified',
  'kyc_pending',
  'high_value',
  'inactive_30d',
  'custom',
] as const;

export const sendPushSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(4000),
    data: z.record(z.string()).optional(),
    image_url: z.string().url().max(2048).optional(),
    deeplink: z.string().trim().max(2048).optional(),

    // Targeting: exactly one of user_ids | segment must be set.
    user_ids: z.array(z.string().uuid()).max(10_000).optional(),
    segment: z.enum(PUSH_SEGMENTS).optional(),

    // Optional throttling for big sends.
    dry_run: z.boolean().default(false),
  })
  .refine(
    (d) =>
      (d.user_ids && d.user_ids.length > 0) ||
      (d.segment && d.segment !== 'custom'),
    {
      message:
        'must provide either user_ids (non-empty) or segment (not "custom")',
      path: ['user_ids'],
    }
  );

/* ------------------------------------------------------------------------- */
/* Mobile config                                                             */
/* ------------------------------------------------------------------------- */

export const mobileConfigQuerySchema = z.object({
  platform: z.enum(PLATFORMS).optional(),
  app_version: z.string().trim().max(50).optional(),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type SendPushInput = z.infer<typeof sendPushSchema>;
export type MobileConfigQuery = z.infer<typeof mobileConfigQuerySchema>;
