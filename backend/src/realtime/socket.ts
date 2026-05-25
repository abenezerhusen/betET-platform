import type { Server as HttpServer } from 'node:http';
import jwt from 'jsonwebtoken';
import { Server as IoServer, type Socket } from 'socket.io';

import { env } from '../config/env';
import { logger } from '../infrastructure/logger';
import { isAllowedOrigin } from '../config/cors';

interface AuthData {
  userId: string;
  tenantId: string;
  role: string;
}

interface AuthPayload {
  sub: string;
  tid: string;
  role: string;
  typ?: string;
}

let io: IoServer | null = null;

const ADMIN_ROLES = new Set(['superadmin', 'tenant_admin']);
const CASHIER_ROLES = new Set(['cashier']);
const PLAYER_ROLES = new Set(['user', 'affiliate']);

/** Initialize Socket.io on the given HTTP server. Idempotent. */
export function initSocketServer(server: HttpServer): IoServer {
  if (io) return io;

  io = new IoServer(server, {
    path: '/socket.io',
    cors: {
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        if (isAllowedOrigin(origin)) return callback(null, true);
        return callback(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    },
    serveClient: false,
    transports: ['websocket', 'polling'],
  });

  // JWT-authenticate on the handshake. Token may come from:
  //  - auth.token in the handshake (Socket.io recommended)
  //  - Authorization: Bearer <token> header (browsers can't set this; for
  //    server clients).
  io.use((socket, next) => {
    try {
      const handshakeToken =
        (socket.handshake.auth?.token as string | undefined) ??
        (socket.handshake.query?.token as string | undefined);
      const headerAuth = socket.handshake.headers.authorization;
      const headerToken =
        headerAuth && /^bearer\s+/i.test(headerAuth)
          ? headerAuth.replace(/^bearer\s+/i, '').trim()
          : undefined;
      const token = handshakeToken ?? headerToken;
      if (!token) return next(new Error('missing access token'));

      const payload = jwt.verify(token, env.jwt.publicKey, {
        algorithms: ['RS256'],
        issuer: env.jwt.issuer,
        audience: env.jwt.audience,
      }) as AuthPayload;

      if (payload.typ === 'refresh') {
        return next(new Error('refresh token not allowed for sockets'));
      }
      if (!payload.sub || !payload.tid || !payload.role) {
        return next(new Error('malformed access token'));
      }

      const data: AuthData = {
        userId: payload.sub,
        tenantId: payload.tid,
        role: payload.role,
      };
      (socket.data as Record<string, unknown>).auth = data;
      next();
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      if (name === 'TokenExpiredError') return next(new Error('access token expired'));
      next(new Error('invalid access token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const auth = (socket.data as Record<string, unknown>).auth as AuthData;
    const rooms = roomsForRole(auth);
    for (const room of rooms) socket.join(room);

    // Compatibility hooks for admin panel clients that still emit join/subscribe
    // events explicitly for P2P feeds.
    socket.on('join', (room: unknown) => {
      if (typeof room !== 'string') return;
      if (room === 'admin' || room === adminRoomName(auth.tenantId)) {
        if (ADMIN_ROLES.has(auth.role)) {
          socket.join(adminRoomName(auth.tenantId));
        }
        return;
      }
      // Game/feed rooms are tenant namespaced to prevent cross-tenant leaks.
      if (room === 'aviator' || room === 'keno' || room === 'live_betting') {
        socket.join(`tenant:${auth.tenantId}:game:${room}`);
      }
    });
    socket.on('p2p:subscribe', () => {
      if (ADMIN_ROLES.has(auth.role)) {
        socket.join(adminRoomName(auth.tenantId));
      }
    });

    logger.debug(
      { userId: auth.userId, tenantId: auth.tenantId, role: auth.role, rooms, sid: socket.id },
      'socket connected'
    );

    socket.on('disconnect', (reason) => {
      logger.debug(
        { userId: auth.userId, sid: socket.id, reason },
        'socket disconnected'
      );
    });
  });

  logger.info('socket.io server initialized');
  return io;
}

export function getSocketServer(): IoServer | null {
  return io;
}

export async function shutdownSocketServer(): Promise<void> {
  if (!io) return;
  await new Promise<void>((resolve) => io!.close(() => resolve()));
  io = null;
}

/* ------------------------------------------------------------------------- */
/* Room helpers                                                              */
/* ------------------------------------------------------------------------- */

/**
 * Personal room for a single user — receives wallet/bet/bonus events.
 * Tenant prefix prevents cross-tenant collisions even if UUIDs were ever
 * to be re-used (defense in depth).
 */
export function userRoomName(tenantId: string, userId: string): string {
  return `tenant:${tenantId}:user:${userId}`;
}
/** Tenant-wide broadcast (all roles). Rarely used. */
export function tenantRoomName(tenantId: string): string {
  return `tenant:${tenantId}`;
}
/** Cashier role room — receives new withdrawal requests and shift alerts. */
export function cashierRoomName(tenantId: string): string {
  return `tenant:${tenantId}:role:cashier`;
}
/** Admin role room — receives live stats and system alerts. */
export function adminRoomName(tenantId: string): string {
  return `tenant:${tenantId}:role:admin`;
}

function roomsForRole(auth: AuthData): string[] {
  const rooms: string[] = [
    userRoomName(auth.tenantId, auth.userId),
    tenantRoomName(auth.tenantId),
  ];
  if (CASHIER_ROLES.has(auth.role)) rooms.push(cashierRoomName(auth.tenantId));
  if (ADMIN_ROLES.has(auth.role)) {
    rooms.push(adminRoomName(auth.tenantId));
    // Admins also get the cashier feed so they can monitor approvals.
    rooms.push(cashierRoomName(auth.tenantId));
  }
  // PLAYER_ROLES already covered by personal user room above; keep the set
  // imported for symmetry / future extension.
  void PLAYER_ROLES;
  return rooms;
}

/* ------------------------------------------------------------------------- */
/* Generic emitters                                                          */
/* ------------------------------------------------------------------------- */

export function emitToUser(
  tenantId: string,
  userId: string,
  event: string,
  payload: unknown
): void {
  if (!io) return;
  try {
    io.to(userRoomName(tenantId, userId)).emit(event, payload);
  } catch (err) {
    logger.error({ err, event, userId }, 'socket.io emitToUser failed');
  }
}

export function emitToTenant(
  tenantId: string,
  event: string,
  payload: unknown
): void {
  if (!io) return;
  try {
    io.to(tenantRoomName(tenantId)).emit(event, payload);
  } catch (err) {
    logger.error({ err, event, tenantId }, 'socket.io emitToTenant failed');
  }
}

export function emitToCashiers(
  tenantId: string,
  event: string,
  payload: unknown
): void {
  if (!io) return;
  try {
    io.to(cashierRoomName(tenantId)).emit(event, payload);
  } catch (err) {
    logger.error({ err, event, tenantId }, 'socket.io emitToCashiers failed');
  }
}

export function emitToAdmins(
  tenantId: string,
  event: string,
  payload: unknown
): void {
  if (!io) return;
  try {
    io.to(adminRoomName(tenantId)).emit(event, payload);
  } catch (err) {
    logger.error({ err, event, tenantId }, 'socket.io emitToAdmins failed');
  }
}

/* ------------------------------------------------------------------------- */
/* Typed event vocabulary                                                    */
/* ------------------------------------------------------------------------- */

/**
 * Canonical event names used across the platform. These are the strings
 * actually sent over the wire — frontends should subscribe by these
 * UPPER_SNAKE_CASE names.
 */
export const Events = {
  WALLET_UPDATED: 'WALLET_UPDATED',
  BET_PLACED: 'BET_PLACED',
  BET_SETTLED: 'BET_SETTLED',
  BONUS_CLAIMED: 'BONUS_CLAIMED',
  NEW_WITHDRAWAL: 'NEW_WITHDRAWAL',
  WITHDRAWAL_PROCESSED: 'WITHDRAWAL_PROCESSED',
  USER_SUSPENDED: 'USER_SUSPENDED',
  USER_REINSTATED: 'USER_REINSTATED',
  SYSTEM_ALERT: 'SYSTEM_ALERT',
  PUSH_NOTIFICATION: 'PUSH_NOTIFICATION',
  P2P_NEW_DEPOSIT: 'P2P_NEW_DEPOSIT',
  P2P_DEVICE_ONLINE: 'P2P_DEVICE_ONLINE',
  P2P_DEVICE_OFFLINE: 'P2P_DEVICE_OFFLINE',
  P2P_COMMAND_RESULT: 'P2P_COMMAND_RESULT',
  P2P_LOW_CAPACITY: 'P2P_LOW_CAPACITY',
  // Section 18 — sportsbook real-time
  ODDS_UPDATE: 'odds:update',
  MATCH_RESULT: 'match:result',
  MATCH_STATUS: 'match:status',
} as const;

export interface WalletUpdatedPayload {
  reason: string;
  /**
   * Wallet snapshot. Typed loosely so callers can pass repository row
   * types (which lack an index signature) without re-mapping. The
   * frontend contract only relies on the canonical fields:
   * `{ id, currency, balance, bonus_balance, locked_balance }`.
   */
  wallet: unknown;
  [k: string]: unknown;
}

export function emitWalletUpdated(
  tenantId: string,
  userId: string,
  payload: WalletUpdatedPayload
): void {
  emitToUser(tenantId, userId, Events.WALLET_UPDATED, payload);
}

export interface BetSettledPayload {
  bet_id: string;
  status: string;
  payout?: string | null;
  currency: string;
  game_id?: string | null;
  session_id?: string | null;
}

export function emitBetSettled(
  tenantId: string,
  userId: string,
  payload: BetSettledPayload
): void {
  emitToUser(tenantId, userId, Events.BET_SETTLED, payload);
}

export interface NewWithdrawalPayload {
  transaction_id: string;
  user_id: string;
  amount: string;
  currency: string;
  payment_method?: string;
  requested_at: string;
}

export function emitNewWithdrawal(
  tenantId: string,
  payload: NewWithdrawalPayload
): void {
  emitToCashiers(tenantId, Events.NEW_WITHDRAWAL, payload);
  // Mirror to admins for monitoring.
  emitToAdmins(tenantId, Events.NEW_WITHDRAWAL, payload);
}

export interface UserSuspendedPayload {
  user_id: string;
  reason?: string;
  by: string | null;
}

export function emitUserSuspended(
  tenantId: string,
  payload: UserSuspendedPayload
): void {
  emitToAdmins(tenantId, Events.USER_SUSPENDED, payload);
  emitToUser(tenantId, payload.user_id, Events.USER_SUSPENDED, payload);
}

export interface SystemAlertPayload {
  level: 'info' | 'warning' | 'error' | 'critical';
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

export function emitSystemAlert(
  tenantId: string,
  payload: SystemAlertPayload
): void {
  emitToAdmins(tenantId, Events.SYSTEM_ALERT, payload);
}
