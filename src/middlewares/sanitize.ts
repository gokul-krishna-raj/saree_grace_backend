import { NextFunction, Request, Response } from 'express';

/**
 * Recursively strips keys starting with `$` or containing `.` from user
 * input to prevent NoSQL (Mongo operator) injection, e.g. a login body of
 * { email: { "$gt": "" }, password: { "$gt": "" } }.
 */
function sanitizeValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item)) as unknown as T;
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (key.startsWith('$') || key.includes('.')) {
        continue;
      }
      result[key] = sanitizeValue(val);
    }
    return result as T;
  }
  return value;
}

export function sanitizeInput(req: Request, _res: Response, next: NextFunction): void {
  if (req.body) {
    req.body = sanitizeValue(req.body);
  }
  if (req.params) {
    req.params = sanitizeValue(req.params);
  }
  if (req.query && Object.keys(req.query).length > 0) {
    const sanitizedQuery = sanitizeValue(req.query as Record<string, unknown>);
    for (const key of Object.keys(req.query)) {
      delete (req.query as Record<string, unknown>)[key];
    }
    Object.assign(req.query as Record<string, unknown>, sanitizedQuery);
  }
  next();
}
