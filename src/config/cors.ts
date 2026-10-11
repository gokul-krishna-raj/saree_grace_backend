import { CorsOptions } from 'cors';
import { env } from './env';
import { ApiError } from '../utils/ApiError';
import { logger } from '../utils/logger';

export function isAllowedOrigin(origin: string): boolean {
  return env.corsOriginList.includes(origin);
}

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    // Allow non-browser clients (no Origin header, e.g. curl, mobile) and
    // any origin explicitly present in CORS_ORIGINS.
    if (!origin || isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }
    // A plain Error here would fall through errorHandler's generic
    // catch-all as an indistinguishable 500 — an ApiError gives a clean
    // 403 that's obviously a CORS/config mismatch, not a server bug.
    // Logged explicitly since ApiError below 500 isn't otherwise logged.
    logger.warn('Rejected CORS origin', { origin, allowed: env.corsOriginList });
    callback(ApiError.forbidden(`Origin ${origin} is not allowed by CORS policy`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  // Lets the admin UI read the filename of CSV downloads (product export).
  exposedHeaders: ['Content-Disposition'],
  // Preflights end inside the cors middleware with this status — they never
  // reach rate limiters, auth, or route handlers.
  optionsSuccessStatus: 204,
  maxAge: 600,
};

/**
 * CORS headers for responses built outside Express (e.g. the Lambda handler's
 * 503 when the DB is unreachable), so the browser surfaces the real error
 * instead of a CORS failure. Empty for missing/disallowed origins.
 */
export function corsHeadersFor(origin: string | undefined): Record<string, string> {
  if (!origin || !isAllowedOrigin(origin)) {
    return {};
  }
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
    vary: 'Origin',
  };
}
