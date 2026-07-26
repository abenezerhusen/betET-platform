/**
 * Zod schema for the sports data provider (Odds-API.io) admin config.
 * Keeps the route thin and the service layer strongly typed.
 */

import { z } from 'zod';

export const providerConfigSchema = z.object({
  enabled: z.boolean().optional(),
  api_url: z.string().trim().url().max(300).optional(),
  /**
   * Plaintext API key from the form. Sealed before storage and never echoed
   * back. Empty / omitted = keep the existing key untouched.
   */
  api_key: z.string().trim().max(400).optional(),
  bookmaker: z.string().trim().min(1).max(60).optional(),
  sports: z.array(z.string().trim().min(1).max(40)).min(1).max(30).optional(),
  /** null / empty = import every league for the selected sports. */
  leagues: z.array(z.string().trim().min(1).max(120)).max(500).nullable().optional(),
  prematch_interval_seconds: z.coerce.number().int().min(60).max(86_400).optional(),
  live_interval_seconds: z.coerce.number().int().min(30).max(3_600).optional(),
  max_requests_per_hour: z.coerce.number().int().min(1).max(100_000).optional(),
  sync_window_hours: z.coerce.number().int().min(1).max(2160).optional(),
});

export type ProviderConfigInput = z.infer<typeof providerConfigSchema>;
