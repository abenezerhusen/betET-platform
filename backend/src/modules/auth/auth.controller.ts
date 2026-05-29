import type { Request, Response, NextFunction } from 'express';
import { env } from '../../config/env';
import { BadRequestError } from '../../http/errors/http-error';
import {
  cashierLoginSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  registerSchema,
  refreshSchema,
  resetPasswordSchema,
} from './auth.dto';
import * as service from './auth.service';

// Admin-tier roles allowed to use the /api/auth/admin/login endpoint.
// Cashier / sales / regular users authenticate via /api/auth/login instead.
const ADMIN_LOGIN_ROLES = new Set([
  'superadmin',
  'tenant_admin',
  'admin',
  'agent',
  'branch',
  'operator',
]);

// Roles allowed to use the public /api/auth/login endpoint (the User Panel).
// Cashier and Sales are shop-floor accounts that must use the cashier
// panel; agent / branch / admin / superadmin / tenant_admin / operator
// must use the admin panel via /api/auth/admin/login. Restricting at the
// token-issuance layer guarantees staff accounts can never appear in the
// Online Users list nor authenticate against /api/user/*.
const USER_LOGIN_ROLES = new Set(['user', 'affiliate']);

// Roles allowed to use the cashier panel login (Section 16).
// Cashiers are pinned to a branch via `metadata.branch_id`; sales staff
// share the same shop-floor surface and may also need to log in here.
const CASHIER_LOGIN_ROLES = new Set(['cashier', 'sales']);

function getIp(req: Request): string | null {
  return req.ip ?? null;
}

function getUa(req: Request): string | null {
  return req.header('user-agent') ?? null;
}

function requireTenantId(req: Request): string {
  if (!req.tenant?.id) {
    throw new BadRequestError('Tenant context required', {
      reason: 'missing_tenant',
    });
  }
  return req.tenant.id;
}

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const body = loginSchema.parse(req.body);
    const tenantId = requireTenantId(req);
    const out = await service.login(tenantId, {
      email: body.email ?? null,
      phone: body.phone ?? null,
      username: body.username ?? null,
      branchId: body.branch_id ?? null,
      password: body.password,
      ip: getIp(req),
      userAgent: getUa(req),
      // User-panel login is end-users only. Agent / branch / sales /
      // cashier / admin-tier accounts must use /api/auth/admin/login
      // (or the cashier panel). Token issuance is blocked at the service
      // layer so staff accounts never appear in the Online Users list.
      allowedRoles: USER_LOGIN_ROLES,
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
}

/**
 * Cashier panel login (Section 16).
 *
 * Only `cashier` / `sales` accounts may obtain tokens here. Identical
 * behaviour to `login`, plus the response is enriched with `branch`
 * (resolved from `users.metadata.branch_*`) so the cashier UI doesn't
 * have to do a second round-trip after sign-in.
 */
export async function cashierLogin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    // Section 16 — cashier panel pins each session to a branch, so we
    // use the stricter `cashierLoginSchema` which marks `branch_id` as
    // required. The service layer then cross-checks the value against
    // the user's `metadata.branch_*` fields.
    const body = cashierLoginSchema.parse(req.body);
    const tenantId = requireTenantId(req);
    const out = await service.login(tenantId, {
      email: body.email ?? null,
      phone: body.phone ?? null,
      username: body.username ?? null,
      branchId: body.branch_id,
      password: body.password,
      ip: getIp(req),
      userAgent: getUa(req),
      allowedRoles: CASHIER_LOGIN_ROLES,
    });
    // Branch lookup — the user.metadata is set by the staff-creation
    // flow (`admin.users.service.validateShopHierarchy`). When the
    // cashier was created without an explicit branch (legacy seed data)
    // we surface `branch: null` so the UI can prompt for setup.
    const branch = await service.getBranchForCashier(tenantId, out.user.id);
    res.json({ ...out, branch });
  } catch (err) {
    next(err);
  }
}

/**
 * Cashier password change (Section 16 — Settings page).
 *
 * Requires the cashier's current password to be supplied along with the
 * new one. Auth middleware guarantees `req.user` is set and we re-assert
 * the role at the service layer.
 */
export async function cashierPasswordChange(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.user) {
      throw new BadRequestError('Authentication required', {
        reason: 'unauthenticated',
      });
    }
    const body = changePasswordSchema.parse(req.body);
    await service.changePasswordForUser({
      userId: req.user.id,
      tenantId: req.user.tenantId,
      currentPassword: body.current_password,
      newPassword: body.new_password,
      ip: getIp(req),
      userAgent: getUa(req),
      allowedRoles: CASHIER_LOGIN_ROLES,
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Admin-only login endpoint per Section 1 of the platform spec.
 *
 * Performs the same authentication work as `login`, but rejects any account
 * whose role is not part of the admin-tier set above. Token issuance,
 * audit logging, account-lock counters, and last_login_at updates are all
 * delegated to the shared `service.login`.
 */
export async function adminLogin(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = loginSchema.parse(req.body);
    const tenantId = requireTenantId(req);
    const out = await service.login(tenantId, {
      email: body.email ?? null,
      phone: body.phone ?? null,
      username: body.username ?? null,
      branchId: body.branch_id ?? null,
      password: body.password,
      ip: getIp(req),
      userAgent: getUa(req),
      // Admin panel login: only admin-tier roles may receive tokens here.
      // The check happens before token issuance so a regular user / sales
      // account never gets a refresh token from this endpoint.
      allowedRoles: ADMIN_LOGIN_ROLES,
    });
    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const body = registerSchema.parse(req.body);
    const tenantId = requireTenantId(req);
    const out = await service.register(tenantId, {
      fullName: body.full_name,
      email: body.email ?? null,
      phone: body.phone ?? null,
      password: body.password,
      referralCode: body.referral_code ?? null,
      ip: getIp(req),
      userAgent: getUa(req),
    });
    res.status(201).json(out);
  } catch (err) {
    next(err);
  }
}

export async function refresh(req: Request, res: Response, next: NextFunction) {
  try {
    const body = refreshSchema.parse(req.body);
    const out = await service.refresh(body.refresh_token, getIp(req), getUa(req));
    res.json(out);
  } catch (err) {
    next(err);
  }
}

export async function logout(req: Request, res: Response, next: NextFunction) {
  try {
    const body = logoutSchema.parse(req.body);
    await service.logout(body.refresh_token, getIp(req), getUa(req));
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = forgotPasswordSchema.parse(req.body);
    const tenantId = requireTenantId(req);
    const out = await service.forgotPassword(
      tenantId,
      body.email ?? null,
      body.phone ?? null,
      getIp(req),
      getUa(req)
    );
    // Never reveal account existence; always 200.
    res.json({
      success: true,
      ...(env.NODE_ENV !== 'production' && out.devToken
        ? { dev_token: out.devToken }
        : {}),
    });
  } catch (err) {
    next(err);
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const body = resetPasswordSchema.parse(req.body);
    const tenantId = requireTenantId(req);
    await service.resetPassword(
      tenantId,
      body.token,
      body.new_password,
      getIp(req),
      getUa(req)
    );
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}
