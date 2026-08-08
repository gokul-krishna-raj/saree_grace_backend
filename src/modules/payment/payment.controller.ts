import crypto from 'crypto';
import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess, sendError } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import * as paymentService from './payment.service';
import {
  CreatePaymentOrderInput,
  RefundOrderInput,
  VerifyPaymentInput,
} from './payment.validation';
import { logger } from '../../utils/logger';

function requireUserId(req: Request): string {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.id;
}

export const createPaymentOrder = asyncHandler(async (req: Request, res: Response) => {
  const { orderId } = req.body as CreatePaymentOrderInput;
  const result = await paymentService.createPaymentOrder(orderId, requireUserId(req));
  sendSuccess(res, result, 201);
});

export const verifyPayment = asyncHandler(async (req: Request, res: Response) => {
  const order = await paymentService.verifyPayment(
    requireUserId(req),
    req.body as VerifyPaymentInput,
  );
  sendSuccess(res, { order });
});

export const refundOrder = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user) throw ApiError.unauthorized();
  const order = await paymentService.refundOrder(
    req.params.id as string,
    req.user.id,
    req.body as RefundOrderInput,
  );
  sendSuccess(res, { order });
});

/**
 * NOT wrapped in asyncHandler's usual success envelope beyond a 200 ack —
 * Razorpay retries deliveries whose response is not a 2xx, so failures here
 * are logged and still acked wherever the failure is not signature-related
 * (an invalid signature is the one case that must be rejected).
 */
export const handleWebhook = async (req: Request, res: Response): Promise<void> => {
  const signature = req.headers['x-razorpay-signature'] as string | undefined;
  const rawBody = req.rawBody;

  if (!rawBody) {
    logger.error('Webhook received without raw body available for signature verification');
    sendError(res, 500, 'Server misconfiguration');
    return;
  }

  let signatureValid: boolean;
  try {
    signatureValid = paymentService.verifyWebhookSignature(rawBody, signature);
  } catch (err) {
    logger.error('Webhook signature verification threw', { error: (err as Error).message });
    sendError(res, 500, 'Server misconfiguration');
    return;
  }

  if (!signatureValid) {
    logger.warn('Rejected Razorpay webhook with invalid signature');
    sendError(res, 400, 'Invalid webhook signature');
    return;
  }

  const eventId =
    (req.headers['x-razorpay-event-id'] as string | undefined) ??
    crypto.createHash('sha256').update(rawBody).digest('hex');

  try {
    await paymentService.processWebhookEvent(eventId, req.body);
    sendSuccess(res, { received: true });
  } catch (err) {
    logger.error('Failed to process Razorpay webhook', { error: (err as Error).message });
    sendError(res, 500, 'Webhook processing failed');
  }
};
