import { Types } from 'mongoose';
import {
  clampLimit,
  encodeCursor,
  decodeCursor,
  MAX_PAGE_LIMIT,
  DEFAULT_PAGE_LIMIT,
} from '../../src/utils/pagination';

describe('pagination utils', () => {
  it('clamps a limit above the maximum', () => {
    expect(clampLimit(10000)).toBe(MAX_PAGE_LIMIT);
  });

  it('falls back to the default for invalid input', () => {
    expect(clampLimit(undefined)).toBe(DEFAULT_PAGE_LIMIT);
    expect(clampLimit('not-a-number')).toBe(DEFAULT_PAGE_LIMIT);
    expect(clampLimit(-5)).toBe(DEFAULT_PAGE_LIMIT);
  });

  it('passes through a valid limit below the max', () => {
    expect(clampLimit(15)).toBe(15);
  });

  it('round-trips an ObjectId through encode/decode', () => {
    const id = new Types.ObjectId();
    const cursor = encodeCursor(id);
    expect(decodeCursor(cursor)).toBe(id.toString());
  });

  it('rejects a malformed cursor', () => {
    expect(decodeCursor('not-a-valid-cursor!!')).toBeNull();
  });
});
