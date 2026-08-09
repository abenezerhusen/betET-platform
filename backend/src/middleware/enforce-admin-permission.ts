/**
 * Role & Permission System — backend enforcement for the Admin Panel.
 *
 * Historically the admin router only checked `requireRole('superadmin',
 * 'tenant_admin')`. That meant:
 *   - A restricted Administrator (role = 'admin', with a per-user permission
 *     set) was rejected outright — the entire admin API returned 403.
 *   - Even if allowed through, no individual permission was ever enforced on
 *     the backend, so page-level gating existed only in the frontend.
 *
 * This middleware closes both gaps. It runs AFTER `authenticateToken()` and
 * `requireRole(...)`, so `req.user.permissions` is populated (resolved at
 * login / refresh from the user's role row or per-user override — see
 * `permissions.helper.ts`).
 *
 * Enforcement model (production-safe):
 *   - Super admins and full administrators carry the wildcard sentinel `'*'`
 *     and bypass every check (unchanged behaviour).
 *   - Everyone else (restricted `admin` accounts) is checked against the
 *     path → permission map below using **any-of** semantics: the caller must
 *     hold at least one of the permissions mapped for that path + HTTP method.
 *   - Deny-by-default: if a `/api/admin/*` path is not covered by any rule,
 *     restricted admins are refused. This is intentional — restricted admins
 *     previously had ZERO admin-API access, so deny-by-default can never
 *     regress an existing working flow while guaranteeing "unauthorized users
 *     cannot call restricted APIs directly".
 *
 * The permission IDs mirror the admin-panel catalog (`src/lib/permissions.ts`)
 * so the frontend page gating and backend API gating stay consistent.
 */

import type { Request, Response, NextFunction } from 'express';
import { ForbiddenError, UnauthorizedError } from '../http/errors/http-error';
import { hasPermission, SUPERADMIN_WILDCARD } from '../modules/auth/permissions.helper';

/* --------------------------- Permission groups ---------------------------- */

const USER_VIEW = [
  'users.online.view',
  'users.administrators.view',
  'users.agents.view',
  'users.branches.view',
  'users.sales.view',
  'users.super_admin.view',
];

const USER_MANAGE = [
  'users.online.manage',
  'users.agents.create',
  'users.agents.edit',
  'users.agents.delete',
  'users.agents.wallet',
  'users.agents.roles',
  'users.branches.manage',
  'users.sales.manage',
  'users.super_admin.manage',
  'admin.create',
  'admin.update',
  'admin.delete',
  'admin.change_password',
  'admin.toggle_status',
  'admin.manage_roles',
];

const ROLE_MANAGE = ['admin.manage_roles', 'users.agents.roles', 'users.super_admin.manage'];

const SETTINGS_ALL = [
  'settings.view',
  'settings.general',
  'settings.main',
  'settings.main_config',
  'settings.payment',
  'settings.security',
  'settings.maintenance',
  'settings.api_management',
  'settings.sms',
  'settings.game_picks',
  'settings.match_stats',
  'settings.sports_provider',
];

const REPORTS_VIEW = ['reports.offline_cash', 'reports.online_cash', 'reports.payable'];
const REPORTS_ALL = [...REPORTS_VIEW, 'reports.export'];

const PROMO_VIEW = [
  'promotions.raffles.view',
  'promotions.referrals.view',
  'promotions.bonus.view',
  'promotions.registration_bonus.view',
  'promotions.cashout.view',
  'promotions.rain.view',
  'promotions.affiliates.view',
];
const PROMO_MANAGE = [
  'promotions.raffles.manage',
  'promotions.referrals.manage',
  'promotions.bonus.manage',
  'promotions.registration_bonus.manage',
  'promotions.cashout.manage',
  'promotions.rain.manage',
  'promotions.affiliates.manage',
];
const PROMO_ALL = [...PROMO_VIEW, ...PROMO_MANAGE];

const MON_VIEW = [
  'monitoring.activity',
  'monitoring.errors',
  'monitoring.performance',
  'monitoring.notifications',
  'monitoring.audit',
];

const P2P_VIEW = [
  'p2p.dashboard',
  'p2p.transactions',
  'p2p.deposit_queue.view',
  'p2p.withdrawal_queue.view',
  'p2p.wallet_devices.view',
  'p2p.operators.view',
  'p2p.operators.access.view',
  'p2p.limits.view',
  'p2p.commissions.view',
  'p2p.commands_queue',
  'p2p.logs',
];
const P2P_MANAGE = [
  'p2p.deposit_queue.approve',
  'p2p.withdrawal_queue.approve',
  'p2p.wallet_devices.manage',
  'p2p.wallet_devices.swap',
  'p2p.wallet_devices.accounts.add',
  'p2p.wallet_devices.accounts.remove',
  'p2p.device_control',
  'p2p.operators.manage',
  'p2p.operators.access.send_link',
  'p2p.operators.access.rotate',
  'p2p.operators.access.revoke',
  'p2p.operators.access.set_permissions',
  'p2p.limits.manage',
  'p2p.commissions.manage',
];
const P2P_ALL = [...P2P_VIEW, ...P2P_MANAGE];

const IFRAME_VIEW = ['iframe.inbound.view', 'iframe.outbound.view'];
const IFRAME_MANAGE = ['iframe.inbound.manage', 'iframe.outbound.manage'];

const TX_VIEW = ['tx.online.view', 'tx.branch.view', 'tx.wallet.view'];
const TX_MANAGE = ['tx.approve', 'tx.cancel', 'tx.export'];

/* ------------------------------ Rule table -------------------------------- */

type Method = 'read' | 'write';
interface Rule {
  re: RegExp;
  /** Permissions accepted for GET/HEAD requests. */
  read: string[];
  /** Permissions accepted for POST/PUT/PATCH/DELETE requests. */
  write: string[];
}

/** Convenience: same permission set for read + write. */
function both(re: RegExp, perms: string[]): Rule {
  return { re, read: perms, write: perms };
}

/**
 * Ordered rules — first match wins, so more specific paths must appear before
 * their broader parents. Paths are matched relative to the /api/admin mount
 * (e.g. `/users`, `/settlement/tickets/123/force-win`).
 */
const RULES: Rule[] = [
  // Superadmin-only surfaces (tenants). Only Super-Admin-scope perms qualify,
  // which restricted Administrators can never hold → effectively denied here
  // while superadmins bypass via the wildcard.
  both(/^\/tenants(\/|$)/, ['users.super_admin.manage', 'users.super_admin.view']),

  // Users — role/permission assignment is the most sensitive write.
  both(/^\/users\/[^/]+\/(permissions|assign-role)(\/|$)/, ROLE_MANAGE),
  { re: /^\/users(\/|$)/, read: USER_VIEW, write: USER_MANAGE },

  // Roles CRUD.
  { re: /^\/roles(\/|$)/, read: ['admin.manage_roles', 'admin.view'], write: ['admin.manage_roles'] },

  // Wallet adjustments (admin credit/debit, agent wallet).
  {
    re: /^\/wallets(\/|$)/,
    read: ['tx.wallet.view', 'users.online.view', 'users.agents.wallet'],
    write: ['users.online.manage', 'users.agents.wallet', 'tx.approve'],
  },

  // Games + RTP + limits + activity.
  { re: /^\/game-activity(\/|$)/, read: ['games.activity.view'], write: ['games.activity.view'] },
  {
    re: /^\/games(\/|$)/,
    read: ['games.view', 'games.settings.view', 'games.settings.manage', 'games.rtp.view', 'games.activity.view'],
    write: ['games.view', 'games.settings.manage', 'games.rtp.edit'],
  },
  both(/^\/game-picks(\/|$)/, ['settings.game_picks']),

  // Settings (Super-Admin-scope catalog).
  both(/^\/settings(\/|$)/, SETTINGS_ALL),
  both(/^\/configurations(\/|$)/, [...IFRAME_VIEW, ...IFRAME_MANAGE, 'apis.view', 'apis.manage', 'settings.view']),
  { re: /^\/iframe(\/|$)/, read: IFRAME_VIEW, write: IFRAME_MANAGE },
  { re: /^\/integrations(\/|$)/, read: ['apis.view'], write: ['apis.manage'] },
  both(/^\/sports-provider(\/|$)/, ['settings.sports_provider']),
  both(/^\/bulk-sms(\/|$)/, ['marketing.bulk_sms']),
  both(/^\/api-management(\/|$)/, ['settings.api_management']),
  both(/^\/maintenance(\/|$)/, ['settings.maintenance']),
  { re: /^\/payment-methods(\/|$)/, read: ['settings.payment', 'settings.view'], write: ['settings.payment'] },

  // Reports.
  { re: /^\/reports(\/|$)/, read: REPORTS_VIEW, write: REPORTS_ALL },
  { re: /^\/panel-reports(\/|$)/, read: REPORTS_VIEW, write: REPORTS_ALL },

  // Monitoring / logs / analytics / notifications / audit.
  both(/^\/audit-logs(\/|$)/, ['monitoring.audit']),
  both(/^\/logs(\/|$)/, MON_VIEW),
  both(/^\/analytics(\/|$)/, MON_VIEW),
  both(/^\/notifications-center(\/|$)/, [...MON_VIEW]),
  both(/^\/notifications(\/|$)/, MON_VIEW),
  both(/^\/monitoring(\/|$)/, MON_VIEW),

  // Promotions (bonuses, raffles, referrals, affiliates, and ops-mounted
  // promotion config endpoints: referral-config / cashout-boost /
  // registration-bonus).
  {
    re: /^\/bonuses(\/|$)/,
    read: ['promotions.bonus.view', 'promotions.registration_bonus.view', 'promotions.cashout.view', 'promotions.rain.view'],
    write: ['promotions.bonus.manage', 'promotions.registration_bonus.manage', 'promotions.cashout.manage', 'promotions.rain.manage'],
  },
  { re: /^\/promotions(\/|$)/, read: PROMO_VIEW, write: PROMO_ALL },
  { re: /^\/raffles(\/|$)/, read: ['promotions.raffles.view'], write: ['promotions.raffles.manage'] },
  { re: /^\/affiliates(\/|$)/, read: ['promotions.affiliates.view'], write: ['promotions.affiliates.manage'] },

  // P2P system + telebirr agent wallets.
  { re: /^\/p2p(\/|$)/, read: P2P_VIEW, write: P2P_MANAGE },
  { re: /^\/telebirr(\/|$)/, read: ['p2p.dashboard', 'p2p.wallet_devices.view'], write: ['p2p.wallet_devices.manage'] },

  // Tournaments & streaks.
  { re: /^\/tournaments(\/|$)/, read: ['tournaments.view'], write: ['tournaments.manage', 'tournaments.streak'] },
  { re: /^\/streaks(\/|$)/, read: ['tournaments.view'], write: ['tournaments.streak', 'tournaments.manage'] },

  // Casino.
  { re: /^\/casino(\/|$)/, read: ['casino.view'], write: ['casino.manage', 'casino.engine'] },

  // Sportsbook tax/bonus config.
  { re: /^\/sportsbook(\/|$)/, read: ['bets.online.view', 'bets.settlement.view'], write: ['bets.settlement.settle'] },

  // Packages.
  { re: /^\/packages(\/|$)/, read: ['packages.view'], write: ['packages.manage'] },

  // Transactions (admin-deposit report + explorer).
  both(/^\/transactions\/admin-deposits(\/|$)/, ['tx.online.view']),
  { re: /^\/transactions(\/|$)/, read: TX_VIEW, write: TX_MANAGE },

  // Bets.
  { re: /^\/bets(\/|$)/, read: ['bets.online.view', 'bets.offline.view'], write: ['bets.cancel', 'bets.payout'] },
  both(/^\/jackpots(\/|$)/, ['bets.jackpots.view']),
  both(/^\/bet-for-me(\/|$)/, ['bets.bet_for_me.view']),

  // Match lifecycle (odds / result / status) + match stats.
  {
    re: /^\/matches(\/|$)/,
    read: ['settings.match_stats', 'bets.online.view'],
    write: ['settings.match_stats', 'bets.settlement.settle'],
  },

  // Ticket settlement & void rules.
  { re: /^\/settlement(\/|$)/, read: ['bets.settlement.view'], write: ['bets.settlement.settle'] },

  // Dashboard (KPIs).
  both(/^\/dashboard(\/|$)/, ['dashboard.view', 'dashboard.kpi', 'dashboard.charts']),

  // Agent Dashboard (agent-scoped shop KPIs). Agents hold `dashboard.agent.view`
  // via their baseline; full admins with `dashboard.view` can also open it.
  both(/^\/agent-dashboard(\/|$)/, ['dashboard.agent.view', 'dashboard.view']),
];

function isReadMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD';
}

/**
 * Express middleware that enforces the admin permission catalog on every
 * `/api/admin/*` request for non-wildcard callers.
 */
export function enforceAdminPermission() {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new UnauthorizedError('Authentication required'));

    const perms = req.user.permissions ?? [];

    // Super admins / full administrators carry the wildcard and bypass all
    // per-permission checks (unchanged behaviour).
    if (perms.includes(SUPERADMIN_WILDCARD)) return next();

    // Normalise the path to be relative to the /api/admin mount. `req.path`
    // inside the admin router is already relative, but strip a leading
    // `/api/admin` defensively in case the mount context differs.
    const path = (req.path || '/').replace(/^\/api\/admin/, '') || '/';
    const method: Method = isReadMethod(req.method) ? 'read' : 'write';

    const rule = RULES.find((r) => r.re.test(path));

    // Deny-by-default: unmapped admin paths are refused for restricted admins.
    if (!rule) {
      return next(
        new ForbiddenError('Insufficient permissions', {
          path,
          reason: 'no_permission_rule',
        })
      );
    }

    const required = method === 'read' ? rule.read : rule.write;
    const ok = required.some((id) => hasPermission(perms, id));
    if (!ok) {
      return next(
        new ForbiddenError('Insufficient permissions', {
          path,
          required,
        })
      );
    }

    next();
  };
}
