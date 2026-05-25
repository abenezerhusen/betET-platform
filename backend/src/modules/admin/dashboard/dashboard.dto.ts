import { z } from 'zod';

const dateInput = z.coerce.date();

export const dashboardStatsSchema = z.object({
  tab: z
    .enum(['summary', 'offline', 'online', 'detailed'])
    .default('summary'),
  from: dateInput.optional(),
  to: dateInput.optional(),
  tenant_id: z.string().uuid().optional(),
});

export type DashboardStatsQuery = z.infer<typeof dashboardStatsSchema>;
export type DashboardTab = DashboardStatsQuery['tab'];

/**
 * Default range = today (00:00 → 23:59:59 UTC). Spec calls for "today" as the
 * default for every dashboard tab; date-pickers on the admin panel can widen
 * it to any range.
 */
export function resolveDashboardRange(input: {
  from?: Date;
  to?: Date;
}): { from: Date; to: Date } {
  if (input.from && input.to) return { from: input.from, to: input.to };
  const now = new Date();
  const startOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0)
  );
  const endOfDay = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );
  return { from: input.from ?? startOfDay, to: input.to ?? endOfDay };
}
