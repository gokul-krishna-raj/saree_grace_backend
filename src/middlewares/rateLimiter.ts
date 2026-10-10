import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { env } from '../config/env';
import { sendError } from '../utils/ApiResponse';
import { verifyAccessToken } from '../utils/tokens';

function rateLimitHandler(_req: unknown, res: Response): void {
  sendError(res, 429, 'Too many requests, please try again later.');
}

/**
 * Every limiter here runs before requireAuth in its respective route chain,
 * so req.user isn't populated yet — this independently verifies the bearer
 * token to decide whether to skip. Only a *valid* admin access token skips;
 * a missing/invalid/expired/non-admin token is rate-limited as normal, so
 * this can't be used to bypass limits (e.g. on /login) without already
 * holding a legitimate admin session.
 */
export function isAdminRequest(req: Request): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return false;
  }
  try {
    const payload = verifyAccessToken(header.slice('Bearer '.length).trim());
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

export const INTERNAL_API_KEY_HEADER = 'x-internal-api-key';

function sha256(value: string): Buffer {
  return crypto.createHash('sha256').update(value).digest();
}

/**
 * True only for the storefront's own server-side requests, which carry the
 * shared INTERNAL_API_KEY. Compared via fixed-length digests so the check is
 * constant-time regardless of the presented value's length. Grants nothing
 * except skipping the global per-IP limit.
 */
export function isInternalRequest(req: Request, expectedKey = env.INTERNAL_API_KEY): boolean {
  const presented = req.headers[INTERNAL_API_KEY_HEADER];
  if (!expectedKey || typeof presented !== 'string' || presented.length === 0) {
    return false;
  }
  return crypto.timingSafeEqual(sha256(presented), sha256(expectedKey));
}

export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: (req) => isAdminRequest(req) || isInternalRequest(req),
});

export const authRateLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skipSuccessfulRequests: false,
  skip: isAdminRequest,
});

export const paymentRateLimiter = rateLimit({
  windowMs: env.PAYMENT_RATE_LIMIT_WINDOW_MS,
  max: env.PAYMENT_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skip: isAdminRequest,
});
