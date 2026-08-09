import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../http/errors/http-error';
import { logger } from '../infrastructure/logger';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: 'not_found',
    message: `Route ${req.method} ${req.path} not found`,
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) {
    logger.error({ err, path: req.path }, 'error after headers sent');
    return;
  }

  if (err instanceof ZodError) {
    // Surface the first specific issue (field + reason) in `message` so the
    // client can show a useful toast instead of a bare "Invalid input". The
    // full issue list is still returned in `details` for debugging.
    const issues = err.issues ?? [];
    const first = issues[0];
    const fieldPath =
      first && Array.isArray(first.path) && first.path.length
        ? first.path.join('.')
        : '';
    const detail = first?.message ?? 'Invalid input';
    res.status(400).json({
      error: 'validation_error',
      message: fieldPath ? `${fieldPath}: ${detail}` : detail,
      details: issues,
    });
    return;
  }

  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
    });
    return;
  }

  logger.error({ err, path: req.path }, 'unhandled error');
  res.status(500).json({
    error: 'internal_server_error',
    message: 'Something went wrong',
  });
}
