import { z } from 'zod';

export const listAuditLogsSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(200).default(50),
  tenant_id: z.string().uuid().optional(),
  actor_id: z.string().uuid().optional(),
  action: z.string().trim().min(1).max(255).optional(),
  action_prefix: z.string().trim().min(1).max(255).optional(),
  resource: z.string().trim().min(1).max(255).optional(),
  resource_id: z.string().trim().min(1).max(255).optional(),
  status: z.enum(['success', 'failure', 'warning', 'info']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  search: z.string().trim().max(255).optional(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsSchema>;
