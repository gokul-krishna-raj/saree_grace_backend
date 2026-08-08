import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { ApiError } from '../utils/ApiError';
import { sendError } from '../utils/ApiResponse';
import { logger } from '../utils/logger';

export function notFoundHandler(req: Request, res: Response): void {
  sendError(res, 404, `Route not found: ${req.method} ${req.originalUrl}`);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const requestId = req.headers['x-request-id'];

  if (err instanceof ZodError) {
    sendError(res, 400, 'Validation failed', err.issues);
    return;
  }

  if (err instanceof ApiError) {
    if (err.statusCode >= 500) {
      logger.error(err.message, { requestId, stack: err.stack });
    }
    sendError(res, err.statusCode, err.message, err.details);
    return;
  }

  if (err instanceof mongoose.Error.ValidationError) {
    sendError(res, 400, 'Validation failed', err.errors);
    return;
  }

  if (err instanceof mongoose.Error.CastError) {
    sendError(res, 400, `Invalid value for field: ${err.path}`);
    return;
  }

  if (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 11000
  ) {
    sendError(
      res,
      409,
      'Duplicate value violates a unique constraint',
      (err as { keyValue?: unknown }).keyValue,
    );
    return;
  }

  const message = err instanceof Error ? err.message : 'Internal server error';
  logger.error('Unhandled error', {
    requestId,
    message,
    stack: err instanceof Error ? err.stack : undefined,
  });
  sendError(res, 500, 'Internal server error');
}
