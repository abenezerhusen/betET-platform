'use client';

import React, { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';
import {
  clearSession,
  hydrate,
  subscribe,
  getSnapshot,
  getServerSnapshot,
  type AuthSnapshot,
} from '../lib/auth/session';
import { authApi, walletApi } from '../lib/api';
import type { AuthUserSummary, WalletApiResponse, WalletSummaryLine } from '../lib/api/types';

function syncLegacyBetSlipBalances(wallet: WalletApiResponse | null): void {
  if (typeof window === 'undefined') return;
  if (!wallet?.summary?.length) return;
  const cur =
    process.env.NEXT_PUBLIC_DEFAULT_CURRENCY?.trim().toUpperCase() || 'ETB';
  const line =
    wallet.summary.find((s: WalletSummaryLine) => s.currency.toUpperCase() === cur) ??
    wallet.summary[0];
  try {
    window.localStorage.setItem('mezzobet_balance', line.balance);
    window.localStorage.setItem('mezzobet_bonus_balance', line.bonus_balance);
    window.dispatchEvent(new Event('mezzobet:balance'));
  } catch {
    /* ignore */
  }
}

interface AuthContextValue {
  ready: boolean;
  isAuthenticated: boolean;
  user: AuthUserSummary | null;
  wallet: WalletApiResponse | null;
  walletLoading: boolean;
  refreshWallet: () => Promise<void>;
  login: (input: { email?: string; phone?: string; password: string }) => Promise<void>;
  register: (input: {
    full_name: string;
    email?: string;
    phone?: string;
    password: string;
    referral_code?: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const snapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  ) as AuthSnapshot;

  const [ready, setReady] = React.useState(false);
  const [wallet, setWallet] = React.useState<WalletApiResponse | null>(null);
  const [walletLoading, setWalletLoading] = React.useState(false);

  useEffect(() => {
    hydrate();
    setReady(true);
  }, []);

  const refreshWallet = useCallback(async () => {
    if (!snapshot.accessToken) {
      setWallet(null);
      return;
    }
    setWalletLoading(true);
    try {
      const w = await walletApi.getWallet();
      setWallet(w);
      syncLegacyBetSlipBalances(w);
    } catch {
      setWallet(null);
    } finally {
      setWalletLoading(false);
    }
  }, [snapshot.accessToken]);

  useEffect(() => {
    if (!ready) return;
    void refreshWallet();
  }, [ready, snapshot.accessToken, refreshWallet]);

  useEffect(() => {
    const onLegacy = () => {
      void refreshWallet();
    };
    window.addEventListener('mezzobet:balance', onLegacy);
    return () => window.removeEventListener('mezzobet:balance', onLegacy);
  }, [refreshWallet]);

  const login = useCallback(
    async (input: Parameters<typeof authApi.login>[0]) => {
      await authApi.login(input);
      await refreshWallet();
    },
    [refreshWallet]
  );

  const register = useCallback(
    async (input: Parameters<typeof authApi.register>[0]) => {
      await authApi.register(input);
      await refreshWallet();
    },
    [refreshWallet]
  );

  const logout = useCallback(async () => {
    await authApi.logout();
    clearSession();
    setWallet(null);
  }, []);

  const value: AuthContextValue = {
    ready,
    isAuthenticated: Boolean(snapshot.accessToken),
    user: snapshot.user,
    wallet,
    walletLoading,
    refreshWallet,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside an <AuthProvider>');
  }
  return ctx;
}
