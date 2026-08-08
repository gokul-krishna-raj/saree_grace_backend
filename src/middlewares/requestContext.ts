import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../utils/logger';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      startTime: number;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction): void {
  req.requestId = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
  req.startTime = Date.now();
  res.setHeader('x-request-id', req.requestId);
  next();
}

export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    if (process.env.NODE_ENV === 'test') return;
    const durationMs = Date.now() - req.startTime;
    logger.info('request', {
      requestId: req.requestId,
      method: req.method,
      route: req.originalUrl,
      status: res.statusCode,
      durationMs,
    });
  });
  next();
}
