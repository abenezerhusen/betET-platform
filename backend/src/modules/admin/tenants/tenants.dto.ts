import { z } from 'zod';

const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'invalid slug');

const statusSchema = z.enum(['active', 'suspended', 'disabled', 'pending']);

export const listTenantsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: statusSchema.optional(),
  search: z.string().trim().max(255).optional(),
});

export const createTenantSchema = z.object({
  name: z.string().trim().min(1).max(255),
  slug: slugSchema,
  config: z.record(z.unknown()).optional(),
  status: statusSchema.optional(),
});

export const updateTenantSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    slug: slugSchema.optional(),
    config: z.record(z.unknown()).optional(),
    status: statusSchema.optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'no fields to update',
  });

export type ListTenantsQuery = z.infer<typeof listTenantsSchema>;
export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
