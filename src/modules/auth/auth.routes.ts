import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { authRateLimiter } from '../../middlewares/rateLimiter';
import { requireAuth } from '../../middlewares/auth';
import * as authController from './auth.controller';
import {
  registerSchema,
  loginSchema,
  googleLoginSchema,
  refreshSchema,
  logoutSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  verifyOtpSchema,
  resendOtpSchema,
} from './auth.validation';

const router = Router();

router.post(
  '/register',
  authRateLimiter,
  validate({ body: registerSchema }),
  authController.register,
);
router.post(
  '/verify-otp',
  authRateLimiter,
  validate({ body: verifyOtpSchema }),
  authController.verifyOtp,
);
router.post(
  '/resend-otp',
  authRateLimiter,
  validate({ body: resendOtpSchema }),
  authController.resendOtp,
);
router.post('/login', authRateLimiter, validate({ body: loginSchema }), authController.login);
router.post(
  '/google',
  authRateLimiter,
  validate({ body: googleLoginSchema }),
  authController.googleLogin,
);
router.post('/refresh', validate({ body: refreshSchema }), authController.refresh);
router.post('/logout', validate({ body: logoutSchema }), authController.logout);
router.post(
  '/forgot-password',
  authRateLimiter,
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword,
);
router.post(
  '/reset-password',
  authRateLimiter,
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);
router.get('/me', requireAuth, authController.me);

export default router;
