import pino from 'pino';
import { env } from '../config/env';

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.new_password',
      'req.body.refresh_token',
      'res.headers["set-cookie"]',
      '*.password',
      '*.password_hash',
      '*.refresh_token',
      '*.access_token',
      '*.token',
    ],
    censor: '[redacted]',
  },
  base: {
    service: 'betet-backend',
    env: env.NODE_ENV,
  },
});

export type Logger = typeof logger;
