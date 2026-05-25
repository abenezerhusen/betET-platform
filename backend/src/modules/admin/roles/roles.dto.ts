import { z } from 'zod';

export const listRolesSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
  status: z.enum(['active', 'disabled']).optional(),
  search: z.string().trim().max(255).optional(),
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(1000).optional(),
  permissions: z.array(z.string().min(1).max(255)).default([]),
  is_system: z.boolean().optional(),
});

export const updateRoleSchema = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    permissions: z.array(z.string().min(1).max(255)).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: 'no fields to update',
  });

/**
 * Section 22 — `PUT /api/admin/roles/:id/permissions` body. A focused
 * shape used by the admin panel "Role Settings" modal — only the
 * permissions array is sent and replaces the role's current set.
 */
export const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.string().min(1).max(255)),
});

export type ListRolesQuery = z.infer<typeof listRolesSchema>;
export type CreateRoleInput = z.infer<typeof createRoleSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;
