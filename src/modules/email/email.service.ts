import { ZodTypeAny } from 'zod';
import { EmailNotification, EmailType } from '../../models/EmailNotification';
import { sendEmail } from '../../utils/mailer';
import { logger } from '../../utils/logger';
import { env } from '../../config/env';
import {
  buildAbandonedCartEventKey,
  buildOrderEventKey,
  buildReturnEventKey,
} from './email.constants';
import {
  abandonedCartEmailTemplate,
  orderCancelledEmailTemplate,
  orderConfirmationEmailTemplate,
  orderDeliveredEmailTemplate,
  orderShippedEmailTemplate,
  passwordResetLinkEmailTemplate,
  paymentFailedEmailTemplate,
  paymentSuccessEmailTemplate,
  refundCompletedEmailTemplate,
  refundInitiatedEmailTemplate,
  returnExchangeStatusEmailTemplate,
  verificationEmailTemplate,
} from './email.templates';
import {
  abandonedCartEmailSchema,
  orderCancelledEmailSchema,
  orderConfirmationEmailSchema,
  orderDeliveredEmailSchema,
  orderShippedEmailSchema,
  passwordResetEmailSchema,
  paymentFailedEmailSchema,
  paymentSuccessEmailSchema,
  refundCompletedEmailSchema,
  refundInitiatedEmailSchema,
  returnExchangeStatusEmailSchema,
  verificationEmailSchema,
} from './email.validation';
import {
  AbandonedCartEmailData,
  EmailResult,
  OrderCancelledEmailData,
  OrderConfirmationEmailData,
  OrderDeliveredEmailData,
  OrderShippedEmailData,
  PasswordResetEmailData,
  PaymentFailedEmailData,
  PaymentSuccessEmailData,
  RefundCompletedEmailData,
  RefundInitiatedEmailData,
  ReturnExchangeStatusEmailData,
  VerificationEmailData,
} from './email.types';

interface DispatchParams {
  eventKey: string;
  emailType: EmailType;
  recipientEmail: string;
  userId?: string;
  orderId?: string;
  subject: string;
  html: string;
}

/**
 * The single send path every send*Email() function funnels through.
 * Idempotent on `eventKey`, and NEVER rethrows — a temporarily-down SMTP
 * server must not fail the order/payment/webhook request that triggered the
 * email. Failures are recorded on the EmailNotification doc for visibility.
 */
export async function dispatchEmail(params: DispatchParams): Promise<EmailResult> {
  const existing = await EmailNotification.findOne({ eventKey: params.eventKey });
  if (existing?.status === 'sent') {
    logger.info('Skipping duplicate email send (already sent for this event)', {
      eventKey: params.eventKey,
      emailType: params.emailType,
    });
    return { skipped: true, sent: false };
  }

  const record =
    existing ??
    (await EmailNotification.create({
      eventKey: params.eventKey,
      emailType: params.emailType,
      recipientEmail: params.recipientEmail,
      orderId: params.orderId,
      userId: params.userId,
      status: 'pending',
    }));

  try {
    await sendEmail(params.recipientEmail, params.subject, params.html);
    record.status = 'sent';
    record.sentAt = new Date();
    record.attempts += 1;
    await record.save();
    logger.info('Email sent', {
      eventKey: params.eventKey,
      emailType: params.emailType,
      to: params.recipientEmail,
      subject: params.subject,
    });
    return { skipped: false, sent: true };
  } catch (err) {
    const message = (err as Error).message;
    record.status = 'failed';
    record.attempts += 1;
    record.lastError = message;
    await record.save();
    logger.error('Email send failed', {
      eventKey: params.eventKey,
      emailType: params.emailType,
      to: params.recipientEmail,
      error: message,
    });
    return { skipped: false, sent: false, error: message };
  }
}

/**
 * Surfaces emails stuck in 'pending'/'failed' for operational visibility.
 * There is no queue in this codebase, and EmailNotification intentionally
 * does not store the full render payload (so no token/amount/address sits
 * around indefinitely) — so this cannot safely reconstruct and re-send a
 * rich template on its own. Real recovery today is re-triggering the
 * originating business event where one naturally exists (e.g. the
 * abandoned-cart job re-evaluates every cart on its own schedule).
 */
export async function retryFailedEmailNotifications(): Promise<{ stuckCount: number }> {
  const stuck = await EmailNotification.find({
    status: { $in: ['pending', 'failed'] },
    attempts: { $lt: 5 },
  }).sort({ createdAt: 1 });

  if (stuck.length > 0) {
    logger.warn('Emails stuck in pending/failed require attention', {
      count: stuck.length,
      eventKeys: stuck.map((s) => s.eventKey),
    });
  }
  return { stuckCount: stuck.length };
}

function validate<T>(schema: ZodTypeAny, data: T): T {
  return schema.parse(data) as T;
}

export async function sendVerificationEmail(data: VerificationEmailData): Promise<EmailResult> {
  const valid = validate(verificationEmailSchema, data);
  const brandName = env.EMAIL_FROM_NAME;
  const { subject, html } = verificationEmailTemplate(valid, brandName);
  return dispatchEmail({
    eventKey: `${valid.recipientEmail}:verification:${valid.verificationUrl}`,
    emailType: 'verification',
    recipientEmail: valid.recipientEmail,
    subject,
    html,
  });
}

export async function sendPasswordResetEmail(data: PasswordResetEmailData): Promise<EmailResult> {
  const valid = validate(passwordResetEmailSchema, data);
  const brandName = env.EMAIL_FROM_NAME;
  const { subject, html } = passwordResetLinkEmailTemplate(valid, brandName);
  return dispatchEmail({
    eventKey: `${valid.recipientEmail}:password-reset:${valid.resetUrl}`,
    emailType: 'password-reset',
    recipientEmail: valid.recipientEmail,
    subject,
    html,
  });
}

export async function sendOrderConfirmationEmail(
  data: OrderConfirmationEmailData,
): Promise<EmailResult> {
  const valid = validate(orderConfirmationEmailSchema, data);
  const { subject, html } = orderConfirmationEmailTemplate(valid, env.SUPPORT_EMAIL);
  return dispatchEmail({
    eventKey: buildOrderEventKey(valid.orderId, 'order-confirmation'),
    emailType: 'order-confirmation',
    recipientEmail: valid.recipientEmail,
    userId: valid.userId,
    orderId: valid.orderId,
    subject,
    html,
  });
}

export async function sendPaymentSuccessEmail(data: PaymentSuccessEmailData): Promise<EmailResult> {
  const valid = validate(paymentSuccessEmailSchema, data);
  const { subject, html } = paymentSuccessEmailTemplate(valid);
  return dispatchEmail({
    eventKey: buildOrderEventKey(valid.orderId, 'payment-success'),
    emailType: 'payment-success',
    recipientEmail: valid.recipientEmail,
    userId: valid.userId,
    orderId: valid.orderId,
    subject,
    html,
  });
}

export async function sendPaymentFailedEmail(data: PaymentFailedEmailData): Promise<EmailResult> {
  const valid = validate(paymentFailedEmailSchema, data);
  const { subject, html } = paymentFailedEmailTemplate(valid, env.SUPPORT_EMAIL);
  return dispatchEmail({
    eventKey: buildOrderEventKey(valid.orderId, 'payment-failed'),
    emailType: 'payment-failed',
    recipientEmail: valid.recipientEmail,
    userId: valid.userId,
    orderId: valid.orderId,
    subject,
    html,
  });
}

export async function sendOrderShippedEmail(data: OrderShippedEmailData): Promise<EmailResult> {
  const valid = validate(orderShippedEmailSchema, data);
  const { subject, html } = orderShippedEmailTemplate(valid);
  return dispatchEmail({
    eventKey: buildOrderEventKey(valid.orderId, 'shipped'),
    emailType: 'shipped',
    recipientEmail: valid.recipientEmail,
    userId: valid.userId,
    orderId: valid.orderId,
    subject,
    html,
  });
}

export async function sendOrderDeliveredEmail(data: OrderDeliveredEmailData): Promise<EmailResult> {
  const valid = validate(orderDeliveredEmailSchema, data);
  const { subject, html } = orderDeliveredEmailTemplate(valid, env.SUPPORT_EMAIL);
  return dispatchEmail({
    eventKey: buildOrderEventKey(valid.orderId, 'delivered'),
    emailType: 'delivered',
    recipientEmail: valid.recipientEmail,
    userId: valid.userId,
    orderId: valid.orderId,
    subject,
    html,
  });
}

export async function sendOrderCancelledEmail(data: OrderCancelledEmailData): Promise<EmailResult> {
  const valid = validate(orderCancelledEmailSchema, data);
  const { subject, html } = orderCancelledEmailTemplate(valid, env.SUPPORT_EMAIL);
  return dispatchEmail({
    eventKey: buildOrderEventKey(valid.orderId, 'cancelled'),
    emailType: 'cancelled',
    recipientEmail: valid.recipientEmail,
    userId: valid.userId,
    orderId: valid.orderId,
    subject,
    html,
  });
}

export async function sendRefundInitiatedEmail(
  data: RefundInitiatedEmailData,
): Promise<EmailResult> {
  const valid = validate(refundInitiatedEmailSchema, data);
  const { subject, html } = refundInitiatedEmailTemplate(valid, env.SUPPORT_EMAIL);
  return dispatchEmail({
    eventKey: buildOrderEventKey(valid.orderId, 'refund-initiated'),
    emailType: 'refund-initiated',
    recipientEmail: valid.recipientEmail,
    userId: valid.userId,
    orderId: valid.orderId,
    subject,
    html,
  });
}

export async function sendRefundCompletedEmail(
  data: RefundCompletedEmailData,
): Promise<EmailResult> {
  const valid = validate(refundCompletedEmailSchema, data);
  const { subject, html } = refundCompletedEmailTemplate(valid, env.SUPPORT_EMAIL);
  return dispatchEmail({
    eventKey: buildOrderEventKey(valid.orderId, 'refund-completed'),
    emailType: 'refund-completed',
    recipientEmail: valid.recipientEmail,
    userId: valid.userId,
    orderId: valid.orderId,
    subject,
    html,
  });
}

export async function sendReturnExchangeStatusEmail(
  data: ReturnExchangeStatusEmailData,
): Promise<EmailResult> {
  const valid = validate(returnExchangeStatusEmailSchema, data);
  const { subject, html } = returnExchangeStatusEmailTemplate(valid, env.SUPPORT_EMAIL);
  return dispatchEmail({
    eventKey: buildReturnEventKey(valid.returnId, valid.status),
    emailType: 'return-status',
    recipientEmail: valid.recipientEmail,
    userId: valid.userId,
    orderId: valid.orderId,
    subject,
    html,
  });
}

export async function sendAbandonedCartEmail(data: AbandonedCartEmailData): Promise<EmailResult> {
  const valid = validate(abandonedCartEmailSchema, data);
  const { subject, html } = abandonedCartEmailTemplate(valid, env.SUPPORT_EMAIL);
  return dispatchEmail({
    eventKey: buildAbandonedCartEventKey(valid.cartId, valid.cartUpdatedAtMs),
    emailType: 'abandoned-cart',
    recipientEmail: valid.recipientEmail,
    userId: valid.userId,
    subject,
    html,
  });
}
