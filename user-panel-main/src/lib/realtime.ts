/**
 * Real-time wallet sync for the user panel.
 *
 * Connects to the backend Socket.io server (same one the game engine and
 * cashier feeds use) authenticated with the user's access token. The backend
 * joins every connection to a personal room `tenant:{tid}:user:{uid}` and
 * emits `WALLET_UPDATED` whenever the balance changes — including cashier
 * deposits / withdrawals and ticket-cancel refunds. We forward those events
 * to a callback so the AuthContext can refresh the displayed balance
 * instantly (Deposit Synchronization requirement).
 */

import { io, type Socket } from 'socket.io-client';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || 'http://localhost:4000';
const TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID?.trim() || 'default';

// Canonical event names emitted by backend/src/realtime/socket.ts.
const WALLET_UPDATED = 'WALLET_UPDATED';

let socket: Socket | null = null;

export interface WalletRealtimeHandlers {
  onWalletUpdated: () => void;
}

/**
 * Open (or reuse) the authenticated socket connection. Returns a disconnect
 * function. Safe to call only in the browser.
 */
export function connectWalletRealtime(
  accessToken: string,
  handlers: WalletRealtimeHandlers
): () => void {
  if (typeof window === 'undefined') return () => {};

  // Tear down any previous connection (e.g. token rotated / user switched).
  disconnectWalletRealtime();

  socket = io(API_BASE_URL, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    auth: { token: accessToken },
    query: { token: accessToken, tenant: TENANT_ID },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on(WALLET_UPDATED, () => {
    try {
      handlers.onWalletUpdated();
    } catch {
      /* ignore */
    }
  });

  return disconnectWalletRealtime;
}

export function disconnectWalletRealtime(): void {
  if (socket) {
    try {
      socket.removeAllListeners();
      socket.disconnect();
    } catch {
      /* ignore */
    }
    socket = null;
  }
}
