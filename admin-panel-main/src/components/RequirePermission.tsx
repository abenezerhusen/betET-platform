/**
 * Section 22 — `<RequirePermission perm="..." />` route gate.
 *
 * Wraps a page element. If the authenticated admin doesn't hold the
 * required permission ID, redirects to `/unauthorized`. Super admins
 * (role === 'superadmin' or permissions === ['*']) always pass through.
 */

import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';

interface RequirePermissionProps {
  perm: string;
  /** Optional: extra permissions all of which must be held. */
  also?: string[];
  /**
   * Optional: accept the granular permission OR a broader "umbrella"
   * permission. When provided, the caller passes the gate if they hold
   * `perm` OR any entry in `anyOf`. This lets a page be gated by a new
   * granular permission (e.g. `promotions.rain.view`) while still allowing
   * existing admins who only hold the umbrella (`promotions.bonus.view`)
   * to keep their access — no regressions.
   */
  anyOf?: string[];
  children: React.ReactNode;
}

export function RequirePermission({ perm, also, anyOf, children }: RequirePermissionProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Primary gate: the specific permission, or any of the accepted
  // alternatives (umbrella fallback).
  const primaryOk = [perm, ...(anyOf ?? [])].some((id) => hasPermission(id));
  // Any `also` permissions are still strictly required (AND semantics).
  const extrasOk = (also ?? []).every((id) => hasPermission(id));
  if (!primaryOk || !extrasOk) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <>{children}</>;
}
