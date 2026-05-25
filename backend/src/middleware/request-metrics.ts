import type { NextFunction, Request, Response } from 'express';
import { pool } from '../infrastructure/db/pool';
import { logger } from '../infrastructure/logger';

function normalizePath(req: Request): string {
  const raw = req.baseUrl ? `${req.baseUrl}${req.path}` : req.path;
  if (!raw) return '/';
  return raw.replace(/\/{2,}/g, '/');
}

export function requestMetricsMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on('finish', () => {
      const path = normalizePath(req);
      if (path === '/health' || path === '/ready' || path.startsWith('/api-docs')) {
        return;
      }

      const duration = Math.max(0, Date.now() - start);
      const errored = res.statusCode >= 400 ? 1 : 0;
      const periodStart = new Date();
      periodStart.setSeconds(0, 0);
      const periodEnd = new Date(periodStart.getTime() + 60_000);

      void pool
        .query(
          `INSERT INTO performance_metrics (
             tenant_id, kind, name, method, request_count, error_count,
             p50_ms, p95_ms, p99_ms, avg_ms, period_start, period_end
           )
           VALUES ($1,'route',$2,$3,1,$4,$5,$5,$5,$5,$6,$7)`,
          [
            req.tenant?.id ?? null,
            path,
            req.method,
            errored,
            duration,
            periodStart.toISOString(),
            periodEnd.toISOString(),
          ]
        )
        .catch((err) => {
          logger.warn({ err, path, method: req.method }, 'request metric write failed');
        });
    });

    next();
  };
}
