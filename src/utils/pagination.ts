import { Types } from 'mongoose';

export const MAX_PAGE_LIMIT = 50;
export const DEFAULT_PAGE_LIMIT = 20;

export function clampLimit(rawLimit: unknown): number {
  const parsed = Number(rawLimit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PAGE_LIMIT;
  }
  return Math.min(Math.floor(parsed), MAX_PAGE_LIMIT);
}

/**
 * Cursor is the base64-encoded ObjectId of the last item seen.
 * Combined with a stable sort (_id desc by default), this gives
 * infinite-scroll pagination that never skips or duplicates items
 * even when new items are inserted concurrently.
 */
export function encodeCursor(id: Types.ObjectId | string): string {
  return Buffer.from(id.toString(), 'utf-8').toString('base64url');
}

export function decodeCursor(cursor: string): string | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    if (!Types.ObjectId.isValid(decoded)) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}
