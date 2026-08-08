import { Response } from 'express';

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ApiErrorBody {
  success: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
  meta?: Record<string, unknown>,
): Response {
  const body: ApiSuccessBody<T> = { success: true, data };
  if (meta) {
    body.meta = meta;
  }
  return res.status(statusCode).json(body);
}

export function sendError(
  res: Response,
  statusCode: number,
  message: string,
  details?: unknown,
): Response {
  const body: ApiErrorBody = {
    success: false,
    error: { message, details },
  };
  return res.status(statusCode).json(body);
}
