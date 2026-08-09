import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_PATH: z.string().default('/api/v1'),

  CORS_ORIGINS: z.string().min(1, 'CORS_ORIGINS must be set (comma-separated origins)'),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_URI_TEST: z.string().optional(),

  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  GOOGLE_CLIENT_ID: z.string().optional(),

  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_UPLOAD_FOLDER: z.string().default('saree-grace'),

  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  PASSWORD_RESET_TOKEN_EXPIRES_MIN: z.coerce.number().int().positive().default(30),

  OTP_EXPIRY_MINUTES: z.coerce.number().int().positive().default(5),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(60),

  EMAIL_HOST: z.string().optional(),
  EMAIL_PORT: z.coerce.number().int().positive().default(587),
  EMAIL_SECURE: z.coerce.boolean().default(false),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASSWORD: z.string().optional(),
  EMAIL_FROM_NAME: z.string().default('Saree Grace'),
  EMAIL_FROM_ADDRESS: z.string().optional(),

  // Customer-facing base URL, used to build order/cart/return links in
  // transactional emails (e.g. `${APP_URL}/orders/:id`).
  APP_URL: z.string().optional(),
  // Falls back to EMAIL_FROM_ADDRESS when unset — see loadEnv() below.
  SUPPORT_EMAIL: z.string().optional(),
  ABANDONED_CART_DELAY_HOURS: z.coerce.number().int().positive().default(24),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  PAYMENT_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(900000),
  PAYMENT_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),

  SEED_ADMIN_EMAIL: z.string().email().optional(),
  SEED_ADMIN_PASSWORD: z.string().optional(),
});

export type Env = Omit<z.infer<typeof envSchema>, 'SUPPORT_EMAIL'> & {
  isProduction: boolean;
  isTest: boolean;
  corsOriginList: string[];
  // Always resolved to a concrete string by loadEnv() (falls back to
  // EMAIL_FROM_ADDRESS), unlike the raw optional schema field.
  SUPPORT_EMAIL: string;
};

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${details}`);
    throw new Error('Environment validation failed. See logs above for details.');
  }

  const data = parsed.data;

  if (data.NODE_ENV === 'production') {
    const productionRequired: Array<keyof typeof data> = [
      'CLOUDINARY_CLOUD_NAME',
      'CLOUDINARY_API_KEY',
      'CLOUDINARY_API_SECRET',
      'RAZORPAY_KEY_ID',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
      'GOOGLE_CLIENT_ID',
      'EMAIL_HOST',
      'EMAIL_USER',
      'EMAIL_PASSWORD',
      'EMAIL_FROM_ADDRESS',
      'APP_URL',
    ];
    const missing = productionRequired.filter((key) => !data[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
    }
  }

  return {
    ...data,
    isProduction: data.NODE_ENV === 'production',
    isTest: data.NODE_ENV === 'test',
    corsOriginList: data.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    // No dedicated support inbox configured yet in most environments —
    // the sender address is a reasonable default to show customers.
    SUPPORT_EMAIL: data.SUPPORT_EMAIL ?? data.EMAIL_FROM_ADDRESS ?? '',
  };
}

export const env = loadEnv();
