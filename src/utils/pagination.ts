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

/**
 * Keyset cursor for listings sorted by a value other than _id (price,
 * rating): encodes the last item's sort value *and* its _id, so the next page
 * starts strictly after that (value, _id) pair. A plain _id cursor is wrong
 * for these sorts — it skips and repeats items because _id order has nothing
 * to do with price order.
 */
export interface SortCursor {
  value: number;
  id: string;
}

export function encodeSortCursor(value: number, id: Types.ObjectId | string): string {
  return Buffer.from(JSON.stringify({ v: value, id: id.toString() }), 'utf-8').toString(
    'base64url',
  );
}

export function decodeSortCursor(cursor: string): SortCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as { v?: unknown }).v === 'number' &&
      Number.isFinite((parsed as { v: number }).v) &&
      typeof (parsed as { id?: unknown }).id === 'string' &&
      Types.ObjectId.isValid((parsed as { id: string }).id)
    ) {
      return { value: (parsed as { v: number }).v, id: (parsed as { id: string }).id };
    }
    return null;
  } catch {
    return null;
  }
}
