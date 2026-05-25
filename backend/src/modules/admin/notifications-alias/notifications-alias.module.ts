/**
 * Section 10 — Monitoring (Notifications top-level alias)
 *
 *   Spec calls notification endpoints out at /api/admin/notifications
 *   (NOT /api/admin/monitoring/notifications). This thin alias re-exposes
 *   the canonical handlers from monitoring.module.ts at the top-level
 *   path so both vocabularies work without code duplication.
 *
 *     GET    /api/admin/notifications
 *     POST   /api/admin/notifications
 *     POST   /api/admin/notifications/:id/cancel
 *     PATCH  /api/admin/notifications/:id/read
 */

import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';

import {
  listNotifications,
  listNotificationsQuerySchema,
  createNotification,
  createNotificationBodySchema,
  cancelNotification,
  markNotificationRead,
} from '../monitoring/monitoring.module';

const idParam = z.object({ id: z.string().uuid() });

const wrap = <T>(fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const wrapStatus =
  <T>(status: number, fn: (req: Request) => Promise<T>) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.status(status).json(await fn(req));
    } catch (err) {
      next(err);
    }
  };

const router = Router();

router.get(
  '/',
  wrap((req) =>
    listNotifications(req, listNotificationsQuerySchema.parse(req.query))
  )
);

router.post(
  '/',
  wrapStatus(201, (req) =>
    createNotification(req, createNotificationBodySchema.parse(req.body))
  )
);

router.post(
  '/:id/cancel',
  wrap((req) => cancelNotification(req, idParam.parse(req.params).id))
);

router.patch(
  '/:id/read',
  wrap((req) => markNotificationRead(req, idParam.parse(req.params).id))
);

export default router;
