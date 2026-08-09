import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { User, UserDocument, UserRole } from '../../models/User';
import { RefreshToken } from '../../models/RefreshToken';
import { PasswordResetToken } from '../../models/PasswordResetToken';
import { Otp, OtpPurpose } from '../../models/Otp';
import { ApiError } from '../../utils/ApiError';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  generateRandomToken,
  generateOtp,
} from '../../utils/tokens';
import { env } from '../../config/env';
import { sendEmail } from '../../utils/mailer';
import { otpEmailTemplate, passwordResetEmailTemplate } from '../../utils/emailTemplates';
import { logger } from '../../utils/logger';

const BCRYPT_SALT_ROUNDS = 12;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function getGoogleClient(): OAuth2Client {
  if (!env.GOOGLE_CLIENT_ID) {
    throw new ApiError(500, 'Google SSO is not configured on this server');
  }
  return new OAuth2Client(env.GOOGLE_CLIENT_ID);
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

async function issueTokenPair(userId: string, role: UserRole): Promise<AuthTokens> {
  const jti = randomUUID();
  const refreshToken = signRefreshToken(userId, role, jti);
  await RefreshToken.create({
    user: userId,
    jti,
    tokenHash: hashToken(refreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  const accessToken = signAccessToken(userId, role);
  return { accessToken, refreshToken };
}

async function generateAndSendOtp(email: string, purpose: OtpPurpose): Promise<void> {
  // Invalidate any OTP already outstanding for this email/purpose before
  // issuing a new one, so only the latest code is ever valid.
  await Otp.deleteMany({ email, purpose });

  const otp = generateOtp();
  await Otp.create({
    email,
    otpHash: hashToken(otp),
    purpose,
    expiresAt: new Date(Date.now() + env.OTP_EXPIRY_MINUTES * 60 * 1000),
  });

  const { subject, html } = otpEmailTemplate(otp, env.OTP_EXPIRY_MINUTES);
  try {
    await sendEmail(email, subject, html);
  } catch (err) {
    // The OTP is already persisted — a transient mail-provider failure must
    // not surface as a 500 on register/resend-otp. The customer can request
    // another send via resend-otp once the provider recovers.
    logger.error('Failed to send OTP email', { email, purpose, error: (err as Error).message });
  }
}

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: UserDocument }> {
  const existing = await User.findOne({ email: input.email });
  if (existing) {
    throw ApiError.conflict('An account with this email already exists');
  }

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);
  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash,
    role: 'customer',
  });

  await generateAndSendOtp(user.email, 'signup');
  return { user };
}

export async function verifyOtp(
  email: string,
  otp: string,
): Promise<{ user: UserDocument; tokens: AuthTokens }> {
  const invalidError = (): ApiError => ApiError.badRequest('Invalid or expired OTP');

  const user = await User.findOne({ email });
  const record = await Otp.findOne({ email, purpose: 'signup' }).sort({ createdAt: -1 });

  // Same generic error whether the account doesn't exist, is already
  // verified, or simply has no OTP on file — never leak which case it is.
  if (!user || user.isVerified || !record) {
    throw invalidError();
  }

  if (record.attempts >= env.OTP_MAX_ATTEMPTS) {
    throw ApiError.tooManyRequests('Too many incorrect attempts. Please request a new OTP.');
  }

  if (record.expiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('OTP has expired. Please request a new one.');
  }

  if (record.otpHash !== hashToken(otp)) {
    record.attempts += 1;
    await record.save();
    throw invalidError();
  }

  user.isVerified = true;
  await user.save();
  await Otp.deleteOne({ _id: record._id });

  const tokens = await issueTokenPair(user._id.toString(), user.role);
  return { user, tokens };
}

export async function resendOtp(email: string): Promise<void> {
  const user = await User.findOne({ email });
  // Always resolve successfully regardless of whether the account exists
  // or is already verified, to avoid leaking which emails are registered.
  if (!user || user.isVerified) {
    return;
  }

  const lastOtp = await Otp.findOne({ email, purpose: 'signup' }).sort({ createdAt: -1 });
  if (
    lastOtp &&
    Date.now() - lastOtp.createdAt.getTime() < env.OTP_RESEND_COOLDOWN_SECONDS * 1000
  ) {
    throw ApiError.tooManyRequests('Please wait before requesting another OTP.');
  }

  await generateAndSendOtp(user.email, 'signup');
}

export async function loginUser(input: {
  email: string;
  password: string;
}): Promise<{ user: UserDocument; tokens: AuthTokens }> {
  const user = await User.findOne({ email: input.email }).select('+passwordHash');
  if (!user || !user.passwordHash) {
    throw ApiError.unauthorized('Invalid email or password');
  }
  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated');
  }
  if (!user.isVerified) {
    throw new ApiError(403, 'Please verify your email before logging in', {
      code: 'EMAIL_NOT_VERIFIED',
    });
  }

  const passwordMatches = await bcrypt.compare(input.password, user.passwordHash);
  if (!passwordMatches) {
    throw ApiError.unauthorized('Invalid email or password');
  }

  const tokens = await issueTokenPair(user._id.toString(), user.role);
  return { user, tokens };
}

export async function loginWithGoogle(
  idToken: string,
): Promise<{ user: UserDocument; tokens: AuthTokens }> {
  const client = getGoogleClient();
  let payload;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch {
    throw ApiError.unauthorized('Invalid Google ID token');
  }

  if (!payload?.sub || !payload.email) {
    throw ApiError.unauthorized('Google token did not include required profile fields');
  }

  let user = await User.findOne({ googleId: payload.sub });
  if (!user) {
    // Link to an existing email/password account rather than creating a duplicate.
    user = await User.findOne({ email: payload.email.toLowerCase() });
    if (user) {
      user.googleId = payload.sub;
      user.isVerified = true;
      await user.save();
    } else {
      user = await User.create({
        name: payload.name ?? payload.email.split('@')[0],
        email: payload.email.toLowerCase(),
        googleId: payload.sub,
        passwordHash: null,
        role: 'customer',
        // Google has already verified ownership of this email address.
        isVerified: true,
      });
    }
  }

  if (!user.isActive) {
    throw ApiError.forbidden('This account has been deactivated');
  }

  const tokens = await issueTokenPair(user._id.toString(), user.role);
  return { user, tokens };
}

export async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw ApiError.unauthorized('Invalid or expired refresh token');
  }

  const stored = await RefreshToken.findOne({ jti: payload.jti });
  if (!stored || stored.tokenHash !== hashToken(refreshToken)) {
    throw ApiError.unauthorized('Refresh token not recognized');
  }

  if (stored.revoked) {
    // Reuse of a revoked/rotated token indicates possible theft — revoke the
    // whole chain for this user as a precaution.
    await RefreshToken.updateMany({ user: stored.user, revoked: false }, { revoked: true });
    logger.warn('Refresh token reuse detected — revoked all sessions for user', {
      userId: stored.user.toString(),
    });
    throw ApiError.unauthorized('Refresh token has already been used');
  }

  if (stored.expiresAt.getTime() < Date.now()) {
    throw ApiError.unauthorized('Refresh token has expired');
  }

  const user = await User.findById(stored.user);
  if (!user || !user.isActive) {
    throw ApiError.unauthorized('User account is no longer active');
  }

  // Rotation: revoke the old token and issue a brand new pair.
  const newJti = randomUUID();
  const newRefreshToken = signRefreshToken(user._id.toString(), user.role, newJti);
  await RefreshToken.create({
    user: user._id,
    jti: newJti,
    tokenHash: hashToken(newRefreshToken),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  });
  stored.revoked = true;
  stored.replacedByJti = newJti;
  await stored.save();

  const accessToken = signAccessToken(user._id.toString(), user.role);
  return { accessToken, refreshToken: newRefreshToken };
}

export async function logoutUser(refreshToken: string): Promise<void> {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    // Already invalid/expired — logging out is idempotent either way.
    return;
  }
  await RefreshToken.updateOne({ jti: payload.jti }, { revoked: true });
}

export async function requestPasswordReset(email: string): Promise<void> {
  // passwordHash is `select: false` on the schema — must opt in explicitly,
  // otherwise this check always sees it as missing and silently no-ops for
  // every user, breaking password reset entirely.
  const user = await User.findOne({ email }).select('+passwordHash');
  // Always resolve successfully regardless of whether the account exists,
  // to avoid leaking which emails are registered.
  if (!user || !user.passwordHash) {
    return;
  }

  const rawToken = generateRandomToken();
  await PasswordResetToken.create({
    user: user._id,
    tokenHash: hashToken(rawToken),
    expiresAt: new Date(Date.now() + env.PASSWORD_RESET_TOKEN_EXPIRES_MIN * 60 * 1000),
  });

  const resetUrl = `${env.corsOriginList[0] ?? ''}/reset-password?token=${rawToken}`;
  const { subject, html } = passwordResetEmailTemplate(resetUrl);
  try {
    await sendEmail(user.email, subject, html);
  } catch (err) {
    // The reset token is already persisted — a transient mail-provider
    // failure must not surface as a 500 on forgot-password (this endpoint
    // always reports success regardless of account state, for the same
    // anti-enumeration reason).
    logger.error('Failed to send password reset email', {
      email: user.email,
      error: (err as Error).message,
    });
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(token);
  const record = await PasswordResetToken.findOne({ tokenHash, used: false });
  if (!record || record.expiresAt.getTime() < Date.now()) {
    throw ApiError.badRequest('Password reset token is invalid or has expired');
  }

  const user = await User.findById(record.user);
  if (!user) {
    throw ApiError.badRequest('Password reset token is invalid or has expired');
  }

  user.passwordHash = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
  await user.save();

  record.used = true;
  await record.save();

  // Invalidate all existing sessions for this user after a password reset.
  await RefreshToken.updateMany({ user: user._id, revoked: false }, { revoked: true });
}
