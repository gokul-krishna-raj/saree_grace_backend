import { request, buildApp, createUser, authHeader } from '../helpers';

describe('Security', () => {
  const app = buildApp();

  const adminRoutes: Array<{ method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string }> =
    [
      { method: 'get', path: '/api/v1/admin/dashboard' },
      { method: 'get', path: '/api/v1/admin/orders' },
      { method: 'get', path: '/api/v1/admin/reviews' },
      { method: 'post', path: '/api/v1/categories' },
      { method: 'post', path: '/api/v1/admin/products' },
    ];

  it.each(adminRoutes)(
    'rejects a customer JWT on admin route $method $path',
    async ({ method, path }) => {
      const customer = await createUser();
      const res = await request(app)[method](path).set(authHeader(customer.token)).send({});
      expect(res.status).toBe(403);
    },
  );

  it.each(adminRoutes)(
    'rejects an unauthenticated request on admin route $method $path',
    async ({ method, path }) => {
      const res = await request(app)[method](path).send({});
      expect(res.status).toBe(401);
    },
  );

  it('never returns the password hash on register, login, or me', async () => {
    const registerRes = await request(app).post('/api/v1/auth/register').send({
      name: 'Secure User',
      email: 'secure@example.com',
      password: 'SecurePass123',
    });
    expect(registerRes.body.data.user.passwordHash).toBeUndefined();
    expect(JSON.stringify(registerRes.body)).not.toContain('passwordHash');

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'secure@example.com', password: 'SecurePass123' });
    expect(JSON.stringify(loginRes.body)).not.toContain('passwordHash');

    const meRes = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${registerRes.body.data.accessToken}`);
    expect(JSON.stringify(meRes.body)).not.toContain('passwordHash');
  });

  it('sets baseline security headers via helmet', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('strips NoSQL operator keys from query parameters instead of letting them reach a filter', async () => {
    // A crafted query attempting an operator injection on a list endpoint.
    // sanitizeInput strips the `$ne` key, leaving `category` as an empty
    // object, which then fails strict Zod validation (400) rather than ever
    // reaching a Mongo query as an operator.
    const res = await request(app).get('/api/v1/products').query({ 'category[$ne]': 'null' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('$ne');
  });
});
