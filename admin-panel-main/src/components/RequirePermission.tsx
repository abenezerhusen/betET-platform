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
  children: React.ReactNode;
}

export function RequirePermission({ perm, also, children }: RequirePermissionProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasPermission = useAuthStore((s) => s.hasPermission);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  const required = [perm, ...(also ?? [])];
  const ok = required.every((id) => hasPermission(id));
  if (!ok) {
    return <Navigate to="/unauthorized" replace />;
  }
  return <>{children}</>;
}
