import rateLimit from 'express-rate-limit';
import { Response } from 'express';
import { env } from '../config/env';
import { sendError } from '../utils/ApiResponse';

function rateLimitHandler(_req: unknown, res: Response): void {
  sendError(res, 429, 'Too many requests, please try again later.');
}

export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  max: env.RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});

export const authRateLimiter = rateLimit({
  windowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  max: env.AUTH_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
  skipSuccessfulRequests: false,
});

export const paymentRateLimiter = rateLimit({
  windowMs: env.PAYMENT_RATE_LIMIT_WINDOW_MS,
  max: env.PAYMENT_RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  handler: rateLimitHandler,
});
