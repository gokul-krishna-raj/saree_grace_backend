describe('env production validation', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  function loadEnvFresh(): typeof import('../../src/config/env') {
    let mod: typeof import('../../src/config/env');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      mod = require('../../src/config/env');
    });
    return mod!;
  }

  it('throws when required production email/link vars are missing', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.EMAIL_HOST;
    delete process.env.APP_URL;

    expect(() => loadEnvFresh()).toThrow(/Missing required production environment variables/);
  });

  it('loads successfully in production once all required vars are present', () => {
    process.env.NODE_ENV = 'production';
    process.env.EMAIL_HOST = 'smtp.example.com';
    process.env.EMAIL_USER = 'user';
    process.env.EMAIL_PASSWORD = 'pass';
    process.env.EMAIL_FROM_ADDRESS = 'noreply@example.com';
    delete process.env.SUPPORT_EMAIL; // exercise the fallback-to-EMAIL_FROM_ADDRESS path
    process.env.APP_URL = 'https://example.com';
    process.env.CLOUDINARY_CLOUD_NAME = 'cloud';
    process.env.CLOUDINARY_API_KEY = 'key';
    process.env.CLOUDINARY_API_SECRET = 'secret';
    process.env.RAZORPAY_KEY_ID = 'rzp_id';
    process.env.RAZORPAY_KEY_SECRET = 'rzp_secret';
    process.env.RAZORPAY_WEBHOOK_SECRET = 'rzp_webhook';
    process.env.GOOGLE_CLIENT_ID = 'google-client-id';

    const { env } = loadEnvFresh();
    expect(env.isProduction).toBe(true);
    expect(env.SUPPORT_EMAIL).toBe('noreply@example.com'); // falls back to EMAIL_FROM_ADDRESS
  });

  it('SUPPORT_EMAIL falls back to EMAIL_FROM_ADDRESS when unset, in any environment', () => {
    delete process.env.SUPPORT_EMAIL;
    process.env.EMAIL_FROM_ADDRESS = 'no-reply@sareegrace.com';

    const { env } = loadEnvFresh();
    expect(env.SUPPORT_EMAIL).toBe('no-reply@sareegrace.com');
  });
});
