import { z } from 'zod';

export const GAME_TYPES = [
  'sports',
  'casino',
  'live_casino',
  'virtual',
  'crash',
  'keno',
  'slot',
  'table',
  'jackpot',
  'custom',
] as const;

export const GAME_STATUSES = [
  'available',
  'maintenance',
  'disabled',
  'archived',
] as const;

const eventDescriptorSchema = z.object({
  name: z.string().trim().min(1).max(255),
  description: z.string().trim().max(1000).optional(),
  // Free-form schema. Most engines use a JSON-Schema-like blob but we don't
  // enforce a particular dialect at the DB layer.
  schema: z.record(z.unknown()).optional(),
});

const iframeConfigSchema = z.object({
  allowed_origins: z
    .array(z.string().trim().url().or(z.literal('*')))
    .max(50)
    .optional(),
  inbound_events: z.array(eventDescriptorSchema).max(100).optional(),
  outbound_events: z.array(eventDescriptorSchema).max(100).optional(),
  sandbox: z.string().trim().max(255).optional(),
  allow: z.string().trim().max(255).optional(),
  init_payload: z.record(z.unknown()).optional(),
});

const gameConfigSchema = z
  .object({
    iframe: iframeConfigSchema.optional(),
    provider_config: z.record(z.unknown()).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .passthrough()
  .default({});

export const listGamesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  provider: z.string().trim().max(255).optional(),
  type: z.enum(GAME_TYPES).optional(),
  status: z.enum(GAME_STATUSES).optional(),
  is_active: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .optional(),
  is_iframe: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((v) => (typeof v === 'string' ? v === 'true' : v))
    .optional(),
  search: z.string().trim().max(255).optional(),
});

export const createGameSchema = z
  .object({
    provider: z.string().trim().min(1).max(255),
    name: z.string().trim().min(1).max(255),
    type: z.enum(GAME_TYPES),
    is_active: z.boolean().default(true),
    is_iframe: z.boolean().default(false),
    iframe_url: z.string().trim().url().max(2048).optional().nullable(),
    rtp: z.number().min(0).max(100).optional().nullable(),
    status: z.enum(GAME_STATUSES).default('available'),
    config: gameConfigSchema.optional(),
  })
  .refine(
    (d) => !d.is_iframe || (d.iframe_url !== null && d.iframe_url !== undefined && d.iframe_url.length > 0),
    {
      message: 'iframe_url is required when is_iframe is true',
      path: ['iframe_url'],
    }
  );

export const updateGameSchema = z
  .object({
    provider: z.string().trim().min(1).max(255).optional(),
    name: z.string().trim().min(1).max(255).optional(),
    type: z.enum(GAME_TYPES).optional(),
    is_active: z.boolean().optional(),
    is_iframe: z.boolean().optional(),
    iframe_url: z.string().trim().url().max(2048).nullable().optional(),
    rtp: z.number().min(0).max(100).nullable().optional(),
    status: z.enum(GAME_STATUSES).optional(),
    config: gameConfigSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'no fields to update' });

export const toggleGameSchema = z.object({
  is_active: z.boolean().optional(),
});

export const listGameSessionsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: z.enum(['active', 'ended', 'expired', 'revoked', 'all']).default('active'),
  user_id: z.string().uuid().optional(),
});

export type ListGamesQuery = z.infer<typeof listGamesSchema>;
export type CreateGameInput = z.infer<typeof createGameSchema>;
export type UpdateGameInput = z.infer<typeof updateGameSchema>;
export type ToggleGameInput = z.infer<typeof toggleGameSchema>;
export type ListGameSessionsQuery = z.infer<typeof listGameSessionsSchema>;
