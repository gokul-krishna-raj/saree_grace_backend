import request from 'supertest';
import { createApp } from '../../src/app';

const ALLOWED = 'http://localhost:3000';

describe('CORS', () => {
  it('answers a preflight with 204 and the allow headers, before auth or validation', async () => {
    const res = await request(createApp())
      .options('/api/v1/auth/google')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toBe('GET,POST,PUT,PATCH,DELETE,OPTIONS');
    expect(res.headers['access-control-allow-headers']).toBe('Content-Type,Authorization');
  });

  it('answers a preflight for an authenticated route without a token', async () => {
    const res = await request(createApp())
      .options('/api/v1/auth/me')
      .set('Origin', ALLOWED)
      .set('Access-Control-Request-Method', 'GET');

    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
  });

  it('keeps CORS headers on error responses', async () => {
    const res = await request(createApp()).get('/api/v1/auth/me').set('Origin', ALLOWED);

    expect(res.status).toBe(401);
    expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('rejects an origin outside CORS_ORIGINS without allow headers', async () => {
    const res = await request(createApp())
      .options('/api/v1/auth/google')
      .set('Origin', 'https://evil.example')
      .set('Access-Control-Request-Method', 'POST');

    expect(res.status).toBe(403);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
