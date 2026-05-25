/**
 * User-facing P2P account list.
 *
 * Endpoint: GET /api/p2p/accounts
 *
 * Returns the list of online Telebirr "agent" phone numbers + sub-account
 * phone numbers the **end user** is allowed to send money to when making
 * a manual deposit. The user-panel Deposit screen renders these so the
 * customer knows exactly which phone to Telebirr their funds to.
 *
 * Security:
 *   - Authenticated end-user only (`requireRole('user','affiliate')`).
 *   - Tenant-scoped: only devices belonging to the caller's tenant are
 *     listed.
 *   - Devices in `maintenance`/`offline` status are filtered out so the
 *     customer never sees an unreachable agent. We DO surface offline
 *     accounts when no online accounts are available, with `status:
 *     'offline'`, so the screen can still render guidance.
 *
 * NOTE: `/api/p2p/*` is otherwise an admin-only alias. This sub-router
 * is mounted ahead of the admin alias in `app.ts`, so the alias never
 * intercepts the `/accounts` path.
 */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { withTenantClient } from '../../infrastructure/db/tenant-client';
import { BadRequestError } from '../../http/errors/http-error';
import { authenticateToken } from '../../middleware/authenticate';
import { requireRole } from '../../middleware/require-role';
import * as swagger from '../../swagger/registry';

const router = Router();

router.use(authenticateToken());
router.use(requireRole('user', 'affiliate'));

swagger.registerPath({
  method: 'get',
  path: '/api/p2p/accounts',
  summary:
    'Agent Telebirr phone numbers a user can send manual deposits to',
  tags: ['P2P', 'User'],
  security: [{ bearerAuth: [] }],
  responses: { '200': { description: 'Accounts list' } },
});

interface P2pAccountRow {
  device_id: string;
  account_id: string | null;
  phone: string;
  label: string;
  status: 'online' | 'offline' | 'maintenance';
  daily_limit_remaining: number | null;
}

router.get(
  '/accounts',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.user) throw new BadRequestError('Authentication required');
      const tenantId = req.user.tenantId;
      const data = await withTenantClient({ tenantId }, async (client) => {
        const rows = await client.query<{
          device_id: string;
          account_id: string | null;
          phone: string;
          label: string | null;
          status: 'online' | 'offline' | 'maintenance';
          daily_limit: string | null;
          used_today: string | null;
        }>(
          `SELECT d.id              AS device_id,
                  la.id             AS account_id,
                  COALESCE(la.phone, d.telebirr_phone) AS phone,
                  COALESCE(la.label, d.label) AS label,
                  d.status,
                  d.daily_limit::text,
                  d.used_today::text
             FROM p2p_devices d
             LEFT JOIN p2p_linked_accounts la
               ON la.device_id = d.id AND la.enabled = true
            WHERE d.tenant_id = $1
              AND (la.id IS NULL OR la.enabled = true)
            ORDER BY (d.status = 'online') DESC,
                     d.last_seen_at DESC NULLS LAST,
                     d.label`,
          [tenantId]
        );

        // Prefer online accounts. If none exist we still show offline
        // ones so the customer can read the phone number — they just
        // can't currently send to it.
        const online = rows.rows.filter((r) => r.status === 'online');
        const offline = rows.rows.filter((r) => r.status !== 'online');
        const pool = online.length > 0 ? online : offline;

        const accounts: P2pAccountRow[] = pool.map((r) => {
          const limit = Number(r.daily_limit ?? 0);
          const used = Number(r.used_today ?? 0);
          const remaining = limit > 0 ? Math.max(0, limit - used) : null;
          return {
            device_id: r.device_id,
            account_id: r.account_id,
            phone: r.phone,
            label: r.label ?? 'Telebirr Agent',
            status: r.status,
            daily_limit_remaining: remaining,
          };
        });

        return { accounts, has_online: online.length > 0 };
      });
      res.json(data);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
