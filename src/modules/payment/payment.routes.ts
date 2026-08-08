import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { paymentRateLimiter } from '../../middlewares/rateLimiter';
import { asyncHandler } from '../../utils/asyncHandler';
import * as paymentController from './payment.controller';
import {
  createPaymentOrderSchema,
  verifyPaymentSchema,
  refundOrderSchema,
  orderIdParamSchema,
} from './payment.validation';

const router = Router();

// The webhook is called by Razorpay's servers, not the browser — no auth
// middleware, no CORS concern, and no generic rate limiting that could drop
// a legitimate retried delivery. Its own signature check is the gate.
router.post('/webhook', asyncHandler(paymentController.handleWebhook));

router.post(
  '/create-order',
  paymentRateLimiter,
  requireAuth,
  validate({ body: createPaymentOrderSchema }),
  paymentController.createPaymentOrder,
);

router.post(
  '/verify',
  paymentRateLimiter,
  requireAuth,
  validate({ body: verifyPaymentSchema }),
  paymentController.verifyPayment,
);

router.post(
  '/:id/refund',
  requireAuth,
  requireAdmin,
  validate({ params: orderIdParamSchema, body: refundOrderSchema }),
  paymentController.refundOrder,
);

export default router;
