import { OrderDocument, OrderStatus } from '../../models/Order';
import { ReturnRequestDocument, ReturnStatus } from '../../models/ReturnRequest';
import { User } from '../../models/User';
import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  sendOrderCancelledEmail,
  sendOrderConfirmationEmail,
  sendOrderDeliveredEmail,
  sendOrderShippedEmail,
  sendPaymentFailedEmail,
  sendPaymentSuccessEmail,
  sendReturnExchangeStatusEmail,
} from './email.service';

function orderViewUrl(orderId: string): string {
  return `${env.APP_URL}/account/orders/${orderId}`;
}

/**
 * Called from order.service.ts's createOrderFromCart(), right after the
 * order transaction commits. Not a status-transition event (the order is
 * still 'pending' at this point), so it lives outside triggerOrderStatusEmail.
 */
export async function triggerOrderConfirmationEmail(order: OrderDocument): Promise<void> {
  try {
    const user = await User.findById(order.user).select('name email').lean();
    if (!user) {
      logger.warn('Skipping order confirmation email — user not found', {
        orderId: order._id.toString(),
      });
      return;
    }

    await sendOrderConfirmationEmail({
      recipientEmail: user.email,
      userId: order.user.toString(),
      orderId: order._id.toString(),
      customerName: user.name,
      orderNumber: order.orderNumber,
      orderDate: order.createdAt,
      items: order.items.map((item) => ({
        name: item.nameSnapshot,
        image: item.imageSnapshot,
        qty: item.qty,
        unitPrice: item.priceSnapshot,
        subtotal: item.priceSnapshot * item.qty,
      })),
      itemsTotal: order.itemsTotal,
      shippingFee: order.shippingFee,
      total: order.total,
      paymentMethod: order.payment.method,
      paymentStatus: order.status,
      deliveryAddressLines: [
        order.shippingAddress.fullName,
        order.shippingAddress.line1,
        order.shippingAddress.line2,
        `${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.postalCode}`,
        order.shippingAddress.country,
      ].filter((line): line is string => Boolean(line)),
      viewOrderUrl: orderViewUrl(order._id.toString()),
    });
  } catch (err) {
    logger.error('Failed to send order confirmation email', {
      orderId: order._id.toString(),
      error: (err as Error).message,
    });
  }
}

/**
 * Called from order.service.ts's transitionOrderStatus() — the single choke
 * point for every real status change — right after the transition is saved.
 * Each branch below is only ever reached via a transition that's already
 * been verified elsewhere (signature-verified payment, a real Razorpay
 * webhook, an admin action), so there's no risk of emailing based on an
 * unconfirmed frontend-only event. Never throws — a mail failure must not
 * unwind an already-committed order status change.
 */
export async function triggerOrderStatusEmail(
  order: OrderDocument,
  to: OrderStatus,
): Promise<void> {
  try {
    const user = await User.findById(order.user).select('name email').lean();
    if (!user) {
      logger.warn('Skipping order status email — user not found', {
        orderId: order._id.toString(),
        to,
      });
      return;
    }

    const base = {
      recipientEmail: user.email,
      userId: order.user.toString(),
      orderId: order._id.toString(),
      customerName: user.name,
      orderNumber: order.orderNumber,
      viewOrderUrl: orderViewUrl(order._id.toString()),
    };

    switch (to) {
      case 'paid': {
        await sendPaymentSuccessEmail({
          ...base,
          amount: order.payment.amountPaid ?? order.total,
          paymentMethod: order.payment.method,
          transactionId: order.payment.razorpayPaymentId ?? 'unknown',
          paymentDate: order.payment.paidAt ?? new Date(),
        });
        return;
      }
      case 'payment_failed': {
        await sendPaymentFailedEmail({
          ...base,
          amount: order.total,
          failureReason: order.payment.failureReason,
          retryPaymentUrl: orderViewUrl(order._id.toString()),
        });
        return;
      }
      case 'shipped': {
        await sendOrderShippedEmail({
          ...base,
          carrier: order.tracking.carrier,
          trackingId: order.tracking.trackingId,
          trackingUrl: order.tracking.trackingUrl,
          shippedDate: new Date(),
        });
        return;
      }
      case 'delivered': {
        await sendOrderDeliveredEmail({
          ...base,
          deliveredDate: new Date(),
          returnInfo: 'Need a return or exchange? Reach out and we’ll help you start one.',
        });
        return;
      }
      case 'cancelled': {
        await sendOrderCancelledEmail({
          ...base,
          cancelledItems: order.items.map((item) => ({ name: item.nameSnapshot, qty: item.qty })),
          cancelledDate: new Date(),
          refundAmount: order.payment.refund?.amount,
          refundStatus: order.payment.refund?.status,
        });
        return;
      }
      default:
        // 'pending' / 'processing' have no customer email in this spec.
        return;
    }
  } catch (err) {
    logger.error('Failed to send order status email', {
      orderId: order._id.toString(),
      to,
      error: (err as Error).message,
    });
  }
}

const RETURN_NEXT_STEPS: Record<ReturnStatus, string> = {
  requested: "We'll review your request and get back to you shortly.",
  approved: "We'll share pickup instructions shortly — no action needed from you yet.",
  rejected: 'If you believe this is a mistake, please contact support.',
  picked_up: "We'll process your item once it reaches our warehouse.",
  completed: 'This request is now closed.',
};

/**
 * Called from return.service.ts on creation and every admin status change.
 * One reusable template branch keyed by `status`, per the spec.
 */
export async function triggerReturnStatusEmail(
  returnRequest: ReturnRequestDocument,
  order: OrderDocument,
): Promise<void> {
  try {
    const user = await User.findById(returnRequest.user).select('name email').lean();
    if (!user) {
      logger.warn('Skipping return status email — user not found', {
        returnId: returnRequest._id.toString(),
      });
      return;
    }

    await sendReturnExchangeStatusEmail({
      recipientEmail: user.email,
      userId: returnRequest.user.toString(),
      orderId: order._id.toString(),
      returnId: returnRequest._id.toString(),
      customerName: user.name,
      orderNumber: order.orderNumber,
      itemNames: returnRequest.items.map((item) => item.nameSnapshot),
      status: returnRequest.status,
      rejectionReason: returnRequest.status === 'rejected' ? returnRequest.adminNote : undefined,
      nextSteps: RETURN_NEXT_STEPS[returnRequest.status],
    });
  } catch (err) {
    logger.error('Failed to send return status email', {
      returnId: returnRequest._id.toString(),
      status: returnRequest.status,
      error: (err as Error).message,
    });
  }
}
