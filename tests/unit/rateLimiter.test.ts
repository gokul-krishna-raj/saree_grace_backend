import express from 'express';
import rateLimitLib from 'express-rate-limit';
import request from 'supertest';
import { isAdminRequest } from '../../src/middlewares/rateLimiter';
import { signAccessToken } from '../../src/utils/tokens';

function bearer(token: string) {
  return { authorization: `Bearer ${token}` } as unknown as { authorization: string };
}

describe('isAdminRequest', () => {
  it('returns false when there is no Authorization header', () => {
    expect(isAdminRequest({ headers: {} } as never)).toBe(false);
  });

  it('returns false for a malformed Authorization header', () => {
    expect(isAdminRequest({ headers: { authorization: 'NotBearer xyz' } } as never)).toBe(false);
  });

  it('returns false for an invalid/garbage token', () => {
    expect(isAdminRequest({ headers: bearer('not-a-real-jwt') } as never)).toBe(false);
  });

  it('returns false for a valid customer token', () => {
    const token = signAccessToken('507f1f77bcf86cd799439011', 'customer');
    expect(isAdminRequest({ headers: bearer(token) } as never)).toBe(false);
  });

  it('returns true for a valid admin token', () => {
    const token = signAccessToken('507f1f77bcf86cd799439011', 'admin');
    expect(isAdminRequest({ headers: bearer(token) } as never)).toBe(true);
  });
});

describe('rate limiter admin bypass (end-to-end against a real limiter instance)', () => {
  function buildTestApp() {
    const app = express();
    const limiter = rateLimitLib({
      windowMs: 60_000,
      max: 2,
      standardHeaders: true,
      legacyHeaders: false,
      skip: isAdminRequest,
      handler: (_req, res) => {
        res.status(429).json({ success: false });
      },
    });
    app.use(limiter);
    app.get('/ping', (_req, res) => res.json({ ok: true }));
    return app;
  }

  it('rate-limits an unauthenticated/customer caller after the max is hit', async () => {
    const app = buildTestApp();
    const customerToken = signAccessToken('507f1f77bcf86cd799439011', 'customer');

    await request(app).get('/ping').set('Authorization', `Bearer ${customerToken}`);
    await request(app).get('/ping').set('Authorization', `Bearer ${customerToken}`);
    const third = await request(app).get('/ping').set('Authorization', `Bearer ${customerToken}`);

    expect(third.status).toBe(429);
  });

  it('never rate-limits a valid admin caller, however many requests are made', async () => {
    const app = buildTestApp();
    const adminToken = signAccessToken('507f1f77bcf86cd799439011', 'admin');

    for (let i = 0; i < 10; i += 1) {
      const res = await request(app).get('/ping').set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
    }
  });
});
