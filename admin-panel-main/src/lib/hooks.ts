/**
 * Shared React hooks for fetching admin-panel data with consistent loading,
 * error, and refresh semantics.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as usersApi from './api/users';
import type { AdminUser } from './api/types';
import { useAuthStore } from '../store/auth';
import { ApiError } from './api/client';
import { toast } from './toast';

export interface PagedHookState<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setPage: (page: number) => void;
}

/**
 * Lightweight 'admin users with a given role' hook used by every
 * SuperAdmin / Administrators / Agents / Branches / Sales / Cashier page.
 */
export function useAdminUsersByRole(
  role: string,
  options: {
    initialLimit?: number;
    pollIntervalMs?: number;
    status?: string;
    search?: string;
  } = {}
): PagedHookState<AdminUser> {
  const isAuth = useAuthStore((s) => s.isAuthenticated);
  const [page, setPage] = useState(1);
  const [limit] = useState(options.initialLimit ?? 100);
  const [items, setItems] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const errToastedRef = useRef<string | null>(null);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!isAuth) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    usersApi
      .listUsers({
        page,
        limit,
        role,
        status: options.status,
        search: options.search,
      })
      .then((res) => {
        if (cancelled) return;
        setItems(res.items);
        setTotal(res.total);
        setLoading(false);
        errToastedRef.current = null;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg =
          err instanceof ApiError ? err.message : String((err as Error)?.message ?? err);
        setError(msg);
        setLoading(false);
        if (errToastedRef.current !== msg) {
          errToastedRef.current = msg;
          toast(`Failed to load ${role}s: ${msg}`);
        }
      });

    const interval = options.pollIntervalMs
      ? window.setInterval(() => setTick((t) => t + 1), options.pollIntervalMs)
      : 0;

    return () => {
      cancelled = true;
      if (interval) window.clearInterval(interval);
    };
  }, [
    role,
    page,
    limit,
    options.status,
    options.search,
    options.pollIntervalMs,
    tick,
    isAuth,
  ]);

  return { items, total, page, limit, loading, error, reload, setPage };
}
