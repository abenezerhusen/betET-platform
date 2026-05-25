import { z } from 'zod';

const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9_.\-]+$/, 'invalid key (alphanumeric, _, ., -)');

const valueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(valueSchema),
    z.record(valueSchema),
  ])
);

export const listSettingsSchema = z.object({
  category: z.string().trim().max(100).optional(),
  key_prefix: z.string().trim().max(255).optional(),
});

export const upsertSettingSchema = z.object({
  value: valueSchema,
  description: z.string().trim().max(1000).nullable().optional(),
  category: z.string().trim().max(100).nullable().optional(),
});

export const bulkUpdateSettingsSchema = z
  .record(keySchema, valueSchema)
  .refine((d) => Object.keys(d).length > 0, {
    message: 'At least one key is required',
  });

export const keyParamSchema = z.object({
  key: keySchema,
});

export type ListSettingsQuery = z.infer<typeof listSettingsSchema>;
export type UpsertSettingInput = z.infer<typeof upsertSettingSchema>;
export type BulkUpdateSettingsInput = z.infer<typeof bulkUpdateSettingsSchema>;
