import { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import multer from 'multer';
import { ApiError } from '../utils/ApiError';
import { sendError } from '../utils/ApiResponse';
import { logger } from '../utils/logger';

const MULTER_ERROR_MESSAGES: Partial<Record<string, string>> = {
  LIMIT_FILE_SIZE: 'One or more files exceed the maximum allowed size',
  LIMIT_FILE_COUNT: 'Too many files in this upload',
  LIMIT_UNEXPECTED_FILE: 'Unexpected file field in this upload',
};

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

  // Without this, a rejected upload (oversized file, too many files, wrong
  // field name) falls through to the generic 500 below — indistinguishable
  // from a real server bug in logs/monitoring, and unhelpful to the caller.
  if (err instanceof multer.MulterError) {
    sendError(res, 400, MULTER_ERROR_MESSAGES[err.code] ?? err.message);
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
