/**
 * Rain Bonus scheduler.
 *
 * Ticks every 15s and, for each active tenant × supported game, decides whether
 * it's time to fire a new rain event based on the admin config
 * (`games.rain.<gameId>`): rains_per_day spread evenly across the optional
 * daily UTC window. Firing itself (opening the claim window, socket broadcast)
 * is delegated to rain.service.ts, which also owns the claim/credit path.
 *
 * Scheduling state (fired-today counter + last-fire time) is kept in memory per
 * tenant:game. It resets at UTC midnight and on process restart — acceptable
 * for a promotional drip; missed fires simply resume on the next tick.
 */
import { logger } from '../infrastructure/logger';
import { pool } from '../infrastructure/db/pool';
import {
  loadRainConfig,
  openRain,
  closeRain,
  getActiveRain,
  type RainConfig,
  type RainGameId,
} from '../services/rain.service';

const TICK_MS = 15 * 1000;
const GAMES: RainGameId[] = ['fast-keno', 'aviator'];
let timer: NodeJS.Timeout | null = null;

interface SchedState {
  dayKey: string;
  firedToday: number;
  lastFiredAt: number;
}
const sched = new Map<string, SchedState>();

async function listTenantIds(): Promise<string[]> {
  const r = await pool.query<{ id: string }>(
    `SELECT id FROM tenants WHERE status = 'active'`
  );
  return r.rows.map((row) => row.id);
}

function utcDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Minutes-since-UTC-midnight for a "HH:MM" string, or null if unparseable. */
function parseHHMM(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Window bounds in minutes [start, end); full day when unset/invalid. */
function windowBounds(cfg: RainConfig): { start: number; end: number } {
  const s = parseHHMM(cfg.window_start);
  const e = parseHHMM(cfg.window_end);
  if (s == null || e == null || s === e) return { start: 0, end: 1440 };
  return { start: s, end: e };
}

function tickTenantGame(tenantId: string, gameId: RainGameId, cfg: RainConfig): void {
  const k = `${tenantId}:${gameId}`;
  if (!cfg.is_enabled) {
    // Ensure nothing lingers when an operator disables rain mid-window.
    if (getActiveRain(tenantId, gameId)) closeRain(tenantId, gameId, 'disabled');
    return;
  }

  const now = new Date();
  const dayKey = utcDayKey(now);
  let st = sched.get(k);
  if (!st || st.dayKey !== dayKey) {
    st = { dayKey, firedToday: 0, lastFiredAt: 0 };
    sched.set(k, st);
  }

  // Don't stack rains — wait for the current one to finish.
  if (getActiveRain(tenantId, gameId)) return;

  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const { start, end } = windowBounds(cfg);
  const inWindow = end > start && nowMin >= start && nowMin < end;
  const windowSpansAllDay = start === 0 && end === 1440;
  if (!windowSpansAllDay && !inWindow) return;

  if (st.firedToday >= cfg.rains_per_day) return;

  // Even spacing across the (possibly full-day) window.
  const windowMinutes = end - start;
  const spacingMs = (windowMinutes / cfg.rains_per_day) * 60 * 1000;
  const sinceLast = st.lastFiredAt ? now.getTime() - st.lastFiredAt : Infinity;
  // Allow the first fire immediately on entering the window.
  if (st.firedToday > 0 && sinceLast < spacingMs) return;

  const opened = openRain(tenantId, gameId, cfg);
  if (opened) {
    st.firedToday += 1;
    st.lastFiredAt = now.getTime();
  }
}

async function tick(): Promise<void> {
  let tenantIds: string[];
  try {
    tenantIds = await listTenantIds();
  } catch (err) {
    logger.error({ err }, 'rain-loop: failed to list tenants');
    return;
  }
  for (const tenantId of tenantIds) {
    for (const gameId of GAMES) {
      try {
        const cfg = await loadRainConfig(tenantId, gameId);
        tickTenantGame(tenantId, gameId, cfg);
      } catch (err) {
        logger.error({ err, tenantId, gameId }, 'rain-loop: tick failed');
      }
    }
  }
}

export function startRainLoop(): void {
  if (timer) return;
  timer = setInterval(() => {
    void tick();
  }, TICK_MS);
  if (typeof timer.unref === 'function') timer.unref();
  logger.info({ tickMs: TICK_MS }, 'rain bonus loop started');
}

export function stopRainLoop(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
