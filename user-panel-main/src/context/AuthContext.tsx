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
import { connectWalletRealtime, disconnectWalletRealtime } from '../lib/realtime';

function syncLegacyBetSlipBalances(wallet: WalletApiResponse | null): void {
  if (typeof window === 'undefined') return;
  if (!wallet?.summary?.length) return;
  const cur =
    process.env.NEXT_PUBLIC_DEFAULT_CURRENCY?.trim().toUpperCase() || 'ETB';
  const line =
    wallet.summary.find((s: WalletSummaryLine) => s.currency.toUpperCase() === cur) ??
    wallet.summary[0];
  try {
    window.localStorage.setItem('1birr_balance', line.balance);
    window.localStorage.setItem('1birr_bonus_balance', line.bonus_balance);
    window.dispatchEvent(new Event('1birr:balance'));
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
    otp_code?: string;
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
      // Keep the last known wallet on a transient failure (network blip,
      // token refresh race, brief 5xx). Wiping it to null here was what made
      // the balance flicker between visible and hidden — and zeroed the
      // balance the branch-withdrawal form relies on. We only clear the
      // wallet on explicit logout / loss of session (handled elsewhere).
    } finally {
      setWalletLoading(false);
    }
  }, [snapshot.accessToken]);

  useEffect(() => {
    if (!ready) return;
    void refreshWallet();
  }, [ready, snapshot.accessToken, refreshWallet]);

  // NOTE: We intentionally do NOT listen for our own `1birr:balance` event
  // here. `refreshWallet()` dispatches that event (via syncLegacyBetSlipBalances)
  // to notify the legacy betslip UI that reads balance from localStorage. If we
  // also refetched on it, every successful fetch would re-dispatch the event and
  // re-trigger a fetch — an infinite loop that hammered /api/user/wallet. Server-
  // authoritative balance changes are covered by the realtime push + focus refresh
  // below and explicit refreshWallet() calls after actions.

  // Real-time wallet sync — listen for backend WALLET_UPDATED pushes (cashier
  // deposits/withdrawals, ticket refunds, bet settlements, etc.) so the
  // displayed balance updates instantly without a manual refresh.
  useEffect(() => {
    if (!ready || !snapshot.accessToken) {
      disconnectWalletRealtime();
      return;
    }
    const disconnect = connectWalletRealtime(snapshot.accessToken, {
      onWalletUpdated: () => {
        void refreshWallet();
      },
    });
    return disconnect;
  }, [ready, snapshot.accessToken, refreshWallet]);

  // Safety net — refresh the balance whenever the tab regains focus, covering
  // any moment the socket was disconnected.
  useEffect(() => {
    if (!ready) return;
    const onFocus = () => {
      if (snapshot.accessToken) void refreshWallet();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [ready, snapshot.accessToken, refreshWallet]);

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
