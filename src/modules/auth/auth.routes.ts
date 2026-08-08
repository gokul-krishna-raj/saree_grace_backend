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
} from './auth.validation';

const router = Router();

router.use(authRateLimiter);

router.post('/register', validate({ body: registerSchema }), authController.register);
router.post('/login', validate({ body: loginSchema }), authController.login);
router.post('/google', validate({ body: googleLoginSchema }), authController.googleLogin);
router.post('/refresh', validate({ body: refreshSchema }), authController.refresh);
router.post('/logout', validate({ body: logoutSchema }), authController.logout);
router.post(
  '/forgot-password',
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword,
);
router.post(
  '/reset-password',
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);
router.get('/me', requireAuth, authController.me);

export default router;
