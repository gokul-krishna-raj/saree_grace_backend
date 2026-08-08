import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { User, UserDocument, UserRole } from '../../models/User';
import { RefreshToken } from '../../models/RefreshToken';
import { PasswordResetToken } from '../../models/PasswordResetToken';
import { ApiError } from '../../utils/ApiError';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  generateRandomToken,
} from '../../utils/tokens';
import { env } from '../../config/env';
import { sendEmail, buildPasswordResetEmailBody } from '../../utils/mailer';
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

export async function registerUser(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: UserDocument; tokens: AuthTokens }> {
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

  const tokens = await issueTokenPair(user._id.toString(), user.role);
  return { user, tokens };
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
      await user.save();
    } else {
      user = await User.create({
        name: payload.name ?? payload.email.split('@')[0],
        email: payload.email.toLowerCase(),
        googleId: payload.sub,
        passwordHash: null,
        role: 'customer',
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
  await sendEmail(
    user.email,
    'Reset your Saree Grace password',
    buildPasswordResetEmailBody(resetUrl),
  );
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
