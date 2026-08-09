import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import * as authService from './auth.service';
import {
  RegisterInput,
  LoginInput,
  GoogleLoginInput,
  RefreshInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  VerifyOtpInput,
  ResendOtpInput,
} from './auth.validation';
import { User } from '../../models/User';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as RegisterInput;
  const { user } = await authService.registerUser(input);
  sendSuccess(res, { user, message: 'A verification code has been sent to your email.' }, 201);
});

export const verifyOtp = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as VerifyOtpInput;
  const { user, tokens } = await authService.verifyOtp(input.email, input.otp);
  sendSuccess(res, { user, ...tokens });
});

export const resendOtp = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ResendOtpInput;
  await authService.resendOtp(input.email);
  sendSuccess(res, {
    message: 'If that account exists and is unverified, a new code has been sent.',
  });
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as LoginInput;
  const { user, tokens } = await authService.loginUser(input);
  sendSuccess(res, { user, ...tokens });
});

export const googleLogin = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as GoogleLoginInput;
  const { user, tokens } = await authService.loginWithGoogle(input.idToken);
  sendSuccess(res, { user, ...tokens });
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as RefreshInput;
  const tokens = await authService.refreshTokens(input.refreshToken);
  sendSuccess(res, tokens);
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as RefreshInput;
  await authService.logoutUser(input.refreshToken);
  sendSuccess(res, { message: 'Logged out' });
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ForgotPasswordInput;
  await authService.requestPasswordReset(input.email);
  sendSuccess(res, { message: 'If that email exists, a reset link has been sent.' });
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const input = req.body as ResetPasswordInput;
  await authService.resetPassword(input.token, input.newPassword);
  sendSuccess(res, { message: 'Password has been reset. Please log in again.' });
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) {
    throw ApiError.unauthorized();
  }
  const user = await User.findById(req.user.id);
  if (!user) {
    throw ApiError.notFound('User not found');
  }
  sendSuccess(res, { user });
});
