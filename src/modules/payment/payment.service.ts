import crypto from 'crypto';
import { getRazorpayClient } from '../../config/razorpay';
import { env } from '../../config/env';
import { Order, OrderDocument } from '../../models/Order';
import { WebhookEvent } from '../../models/WebhookEvent';
import { ApiError } from '../../utils/ApiError';
import { logger } from '../../utils/logger';
import {
  getOrderByIdForUser,
  getOrderByIdForAdmin,
  transitionOrderStatus,
} from '../order/order.service';
import { User } from '../../models/User';
import { sendRefundCompletedEmail, sendRefundInitiatedEmail } from '../email/email.service';

export interface CreatePaymentOrderResult {
  razorpayOrderId: string;
  amount: number;
  currency: string;
  keyId: string;
  internalOrderId: string;
}

export async function createPaymentOrder(
  orderId: string,
  userId: string,
): Promise<CreatePaymentOrderResult> {
  const order = await getOrderByIdForUser(orderId, userId);
  if (!['pending', 'payment_failed'].includes(order.status)) {
    throw ApiError.conflict(`Cannot initiate payment for an order in status "${order.status}"`);
  }

  const razorpay = getRazorpayClient();
  const amountInPaise = Math.round(order.total * 100);
  const rpOrder = await razorpay.orders.create({
    amount: amountInPaise,
    currency: 'INR',
    receipt: order.orderNumber,
    notes: { internalOrderId: order._id.toString() },
  });

  order.payment.razorpayOrderId = rpOrder.id;
  if (order.status === 'payment_failed') {
    order.status = 'pending';
    order.statusHistory.push({
      status: 'pending',
      changedAt: new Date(),
      note: 'Payment retry initiated',
    });
  }
  await order.save();

  return {
    razorpayOrderId: rpOrder.id,
    amount: amountInPaise,
    currency: 'INR',
    keyId: env.RAZORPAY_KEY_ID as string,
    internalOrderId: order._id.toString(),
  };
}

function computePaymentSignature(razorpayOrderId: string, razorpayPaymentId: string): string {
  return crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET as string)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest('hex');
}

export async function verifyPayment(
  userId: string,
  input: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string },
): Promise<OrderDocument> {
  const order = await Order.findOne({
    'payment.razorpayOrderId': input.razorpayOrderId,
    user: userId,
  });
  if (!order) {
    throw ApiError.notFound('No order found for this payment');
  }

  const expectedSignature = computePaymentSignature(input.razorpayOrderId, input.razorpayPaymentId);
  const providedBuffer = Buffer.from(input.razorpaySignature);
  const expectedBuffer = Buffer.from(expectedSignature);
  const signatureValid =
    providedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(providedBuffer, expectedBuffer);

  if (!signatureValid) {
    throw ApiError.badRequest('Payment signature verification failed');
  }

  // Idempotent: the webhook may have already marked this order paid — the
  // webhook remains the ultimate source of truth, this is just faster
  // feedback to the client since the signature is independently verified.
  if (order.status === 'paid') {
    return order;
  }
  if (order.status !== 'pending') {
    throw ApiError.conflict(`Order is in status "${order.status}" and cannot be marked paid`);
  }

  order.payment.razorpayPaymentId = input.razorpayPaymentId;
  order.payment.razorpaySignature = input.razorpaySignature;
  order.payment.paidAt = new Date();
  order.payment.amountPaid = order.total;

  return transitionOrderStatus(order, 'paid', { note: 'Verified via client-side callback' });
}

export function verifyWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
): boolean {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET is not configured');
  }
  if (!signatureHeader) {
    return false;
  }
  const expected = crypto
    .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(signatureHeader);
  return (
    expectedBuffer.length === providedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

interface RazorpayWebhookBody {
  event: string;
  payload: {
    payment?: {
      entity: {
        id: string;
        order_id: string;
        method?: string;
        amount: number;
        error_description?: string;
      };
    };
    refund?: {
      entity: {
        id: string;
      };
    };
  };
}

async function notifyRefundEmail(
  order: OrderDocument,
  emailType: 'initiated' | 'completed',
): Promise<void> {
  try {
    const user = await User.findById(order.user).select('name email').lean();
    if (!user || !order.payment.refund) return;

    const base = {
      recipientEmail: user.email,
      userId: order.user.toString(),
      orderId: order._id.toString(),
      customerName: user.name,
      orderNumber: order.orderNumber,
      refundAmount: order.payment.refund.amount,
      refundReferenceId: order.payment.refund.razorpayRefundId,
    };

    if (emailType === 'initiated') {
      await sendRefundInitiatedEmail({
        ...base,
        refundReason: order.payment.refund.reason,
        refundStatus: order.payment.refund.status,
      });
    } else {
      await sendRefundCompletedEmail({
        ...base,
        paymentMethod: order.payment.method,
        completionDate: order.payment.refund.refundedAt,
      });
    }
  } catch (err) {
    logger.error('Failed to send refund email', {
      orderId: order._id.toString(),
      emailType,
      error: (err as Error).message,
    });
  }
}

export async function processWebhookEvent(
  eventId: string,
  body: RazorpayWebhookBody,
): Promise<void> {
  try {
    await WebhookEvent.create({ provider: 'razorpay', eventId, eventType: body.event });
  } catch (err) {
    if (typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000) {
      logger.info('Duplicate Razorpay webhook delivery ignored', {
        eventId,
        eventType: body.event,
      });
      return;
    }
    throw err;
  }

  if (body.event === 'refund.processed') {
    const refundEntity = body.payload.refund?.entity;
    if (!refundEntity) {
      logger.info('refund.processed webhook without a refund entity ignored');
      return;
    }
    const order = await Order.findOne({ 'payment.refund.razorpayRefundId': refundEntity.id });
    if (!order?.payment.refund) {
      logger.warn('Webhook received for unknown Razorpay refund', { refundId: refundEntity.id });
      return;
    }
    if (order.payment.refund.status === 'processed') return; // already processed, safe no-op
    order.payment.refund.status = 'processed';
    await order.save();
    await notifyRefundEmail(order, 'completed');
    return;
  }

  const paymentEntity = body.payload.payment?.entity;
  if (!paymentEntity) {
    logger.info('Webhook event without payment entity ignored', { eventType: body.event });
    return;
  }

  const order = await Order.findOne({ 'payment.razorpayOrderId': paymentEntity.order_id });
  if (!order) {
    logger.warn('Webhook received for unknown Razorpay order', {
      razorpayOrderId: paymentEntity.order_id,
    });
    return;
  }

  if (body.event === 'payment.captured') {
    if (order.status === 'paid') return; // already processed, safe no-op
    if (order.status !== 'pending') {
      logger.warn('Ignoring payment.captured for order not in pending state', {
        orderId: order._id.toString(),
        status: order.status,
      });
      return;
    }
    order.payment.razorpayPaymentId = paymentEntity.id;
    order.payment.method = paymentEntity.method;
    order.payment.amountPaid = paymentEntity.amount / 100;
    order.payment.paidAt = new Date();
    await transitionOrderStatus(order, 'paid', { note: 'Confirmed via Razorpay webhook' });
    return;
  }

  if (body.event === 'payment.failed') {
    if (order.status !== 'pending') return;
    order.payment.failureReason = paymentEntity.error_description ?? 'Payment failed';
    await transitionOrderStatus(order, 'payment_failed', { note: order.payment.failureReason });
    return;
  }

  logger.info('Unhandled Razorpay webhook event type', { eventType: body.event });
}

export async function refundOrder(
  orderId: string,
  adminId: string,
  input: { amount?: number; reason?: string },
): Promise<OrderDocument> {
  const order = await getOrderByIdForAdmin(orderId);
  if (!order.payment.razorpayPaymentId) {
    throw ApiError.conflict('This order has no captured payment to refund');
  }
  if (order.payment.refund?.razorpayRefundId) {
    throw ApiError.conflict('This order has already been refunded');
  }
  if (!['paid', 'processing', 'shipped', 'delivered'].includes(order.status)) {
    throw ApiError.conflict(`Order in status "${order.status}" cannot be refunded`);
  }

  const razorpay = getRazorpayClient();
  const refund = await razorpay.payments.refund(
    order.payment.razorpayPaymentId,
    input.amount ? { amount: Math.round(input.amount * 100) } : {},
  );

  order.payment.refund = {
    razorpayRefundId: refund.id,
    amount: Number(refund.amount) / 100,
    reason: input.reason,
    refundedAt: new Date(),
    status: 'processing',
  };

  let result: OrderDocument;
  if (order.status === 'paid' || order.status === 'processing') {
    result = await transitionOrderStatus(order, 'cancelled', {
      changedBy: adminId,
      note: `Refunded: ${input.reason ?? 'Admin-initiated refund'}`,
    });
  } else {
    await order.save();
    result = order;
  }

  await notifyRefundEmail(result, 'initiated');
  return result;
}
