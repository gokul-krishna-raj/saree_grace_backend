import { request, buildApp } from '../helpers';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { User } from '../../src/models/User';
import * as mailer from '../../src/utils/mailer';

jest.mock('google-auth-library');

describe('Auth', () => {
  const app = buildApp();

  describe('POST /api/v1/auth/register', () => {
    it('registers a new user and returns tokens', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        name: 'Jane Doe',
        email: 'jane@example.com',
        password: 'SuperSecret123',
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe('jane@example.com');
      expect(res.body.data.accessToken).toEqual(expect.any(String));
      expect(res.body.data.refreshToken).toEqual(expect.any(String));
      expect(res.body.data.user.passwordHash).toBeUndefined();
    });

    it('rejects duplicate email registration', async () => {
      await request(app).post('/api/v1/auth/register').send({
        name: 'Jane Doe',
        email: 'dupe@example.com',
        password: 'SuperSecret123',
      });

      const res = await request(app).post('/api/v1/auth/register').send({
        name: 'Jane Doe 2',
        email: 'dupe@example.com',
        password: 'AnotherPass123',
      });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
    });

    it('rejects a weak/invalid payload', async () => {
      const res = await request(app).post('/api/v1/auth/register').send({
        name: 'A',
        email: 'not-an-email',
        password: '123',
      });
      expect(res.status).toBe(400);
    });

    it('strips $-prefixed keys from the request body (NoSQL injection guard)', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: { $gt: '' }, password: { $gt: '' } });
      // After sanitization these become empty objects, which fail Zod's
      // string().email() validation -> 400, never a query-level bypass.
      expect(res.status).toBe(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await request(app).post('/api/v1/auth/register').send({
        name: 'Login User',
        email: 'login@example.com',
        password: 'CorrectHorse123',
      });
    });

    it('logs in with correct credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'login@example.com', password: 'CorrectHorse123' });
      expect(res.status).toBe(200);
      expect(res.body.data.accessToken).toEqual(expect.any(String));
    });

    it('rejects invalid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'login@example.com', password: 'WrongPassword' });
      expect(res.status).toBe(401);
    });

    it('rejects login for a nonexistent user without leaking existence', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: 'whatever123' });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('rejects an expired access token', async () => {
      const user = await User.create({
        name: 'Expired',
        email: 'expired@example.com',
        passwordHash: 'irrelevant',
        role: 'customer',
      });
      const expiredToken = jwt.sign(
        { sub: user._id.toString(), role: 'customer', tokenType: 'access' },
        process.env.JWT_ACCESS_SECRET as string,
        { expiresIn: -10 },
      );
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);
      expect(res.status).toBe(401);
    });

    it('rejects a missing token', async () => {
      const res = await request(app).get('/api/v1/auth/me');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/auth/google', () => {
    it('logs in (find-or-create) with a valid Google ID token', async () => {
      const mockVerifyIdToken = jest.fn().mockResolvedValue({
        getPayload: () => ({
          sub: 'google-sub-123',
          email: 'googleuser@example.com',
          name: 'Google User',
        }),
      });
      (OAuth2Client as unknown as jest.Mock).mockImplementation(() => ({
        verifyIdToken: mockVerifyIdToken,
      }));

      const res = await request(app)
        .post('/api/v1/auth/google')
        .send({ idToken: 'fake-valid-token' });

      expect(res.status).toBe(200);
      expect(res.body.data.user.email).toBe('googleuser@example.com');
      expect(res.body.data.user.googleId).toBe('google-sub-123');
    });

    it('rejects an invalid Google ID token', async () => {
      const mockVerifyIdToken = jest.fn().mockRejectedValue(new Error('invalid token'));
      (OAuth2Client as unknown as jest.Mock).mockImplementation(() => ({
        verifyIdToken: mockVerifyIdToken,
      }));

      const res = await request(app).post('/api/v1/auth/google').send({ idToken: 'garbage' });
      expect(res.status).toBe(401);
    });
  });

  describe('refresh + logout', () => {
    it('rotates refresh tokens and rejects reuse of the old one', async () => {
      const registerRes = await request(app).post('/api/v1/auth/register').send({
        name: 'Refresh User',
        email: 'refresh@example.com',
        password: 'RefreshPass123',
      });
      const { refreshToken } = registerRes.body.data;

      const refreshRes = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.data.refreshToken).not.toBe(refreshToken);

      const reuseRes = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(reuseRes.status).toBe(401);
    });

    it('logout invalidates the refresh token', async () => {
      const registerRes = await request(app).post('/api/v1/auth/register').send({
        name: 'Logout User',
        email: 'logout@example.com',
        password: 'LogoutPass123',
      });
      const { refreshToken } = registerRes.body.data;

      const logoutRes = await request(app).post('/api/v1/auth/logout').send({ refreshToken });
      expect(logoutRes.status).toBe(200);

      const refreshRes = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
      expect(refreshRes.status).toBe(401);
    });
  });

  describe('password reset', () => {
    it('completes the forgot-password -> reset-password flow and invalidates old sessions', async () => {
      const registerRes = await request(app).post('/api/v1/auth/register').send({
        name: 'Reset User',
        email: 'reset@example.com',
        password: 'OldPassword123',
      });
      const { refreshToken: oldRefreshToken } = registerRes.body.data;

      const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);

      const forgotRes = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'reset@example.com' });
      expect(forgotRes.status).toBe(200);
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);

      const emailBody = sendEmailSpy.mock.calls[0]?.[2] as string;
      const resetUrlMatch = /reset-password\?token=([a-f0-9]+)/.exec(
        (sendEmailSpy.mock.calls[0]?.[2] as string) ?? '',
      );
      expect(resetUrlMatch).not.toBeNull();
      const token = resetUrlMatch?.[1] as string;
      void emailBody;

      const resetRes = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token, newPassword: 'NewPassword456' });
      expect(resetRes.status).toBe(200);

      const oldLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'reset@example.com', password: 'OldPassword123' });
      expect(oldLoginRes.status).toBe(401);

      const newLoginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'reset@example.com', password: 'NewPassword456' });
      expect(newLoginRes.status).toBe(200);

      // Sessions issued before the reset must no longer work.
      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: oldRefreshToken });
      expect(refreshRes.status).toBe(401);

      sendEmailSpy.mockRestore();
    });

    it('does not leak whether an email is registered', async () => {
      const sendEmailSpy = jest.spyOn(mailer, 'sendEmail').mockResolvedValue(undefined);
      const res = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'not-registered@example.com' });
      expect(res.status).toBe(200);
      expect(sendEmailSpy).not.toHaveBeenCalled();
      sendEmailSpy.mockRestore();
    });

    it('rejects an invalid or already-used reset token', async () => {
      const res = await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: 'not-a-real-token', newPassword: 'Whatever123' });
      expect(res.status).toBe(400);
    });
  });
});
