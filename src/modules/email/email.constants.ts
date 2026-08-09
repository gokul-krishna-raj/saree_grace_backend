import { ReturnStatus } from '../../models/ReturnRequest';

// Idempotency keys follow `<entityId>:<eventType>` throughout — a unique
// index on EmailNotification.eventKey is what actually enforces "never send
// the same email twice for the same event".
export const buildOrderEventKey = (
  orderId: string,
  event:
    | 'order-confirmation'
    | 'payment-success'
    | 'payment-failed'
    | 'shipped'
    | 'delivered'
    | 'cancelled'
    | 'refund-initiated'
    | 'refund-completed',
): string => `${orderId}:${event}`;

export const buildReturnEventKey = (returnId: string, status: ReturnStatus): string =>
  `${returnId}:${status}`;

export const buildAbandonedCartEventKey = (cartId: string, cartUpdatedAtMs: number): string =>
  `${cartId}:abandoned-cart:${cartUpdatedAtMs}`;

export const EMAIL_SUBJECTS = {
  verification: () => 'Verify your Saree Grace email address',
  passwordReset: () => 'Reset your Saree Grace password',
  orderConfirmation: (orderNumber: string) => `Order confirmed: ${orderNumber}`,
  paymentSuccess: (orderNumber: string) => `Payment received for order ${orderNumber}`,
  paymentFailed: (orderNumber: string) => `Payment failed for order ${orderNumber}`,
  orderShipped: (orderNumber: string) => `Your order ${orderNumber} has been shipped`,
  orderDelivered: (orderNumber: string) => `Your order ${orderNumber} has been delivered`,
  orderCancelled: (orderNumber: string) => `Order ${orderNumber} cancelled`,
  refundInitiated: (orderNumber: string) => `Refund initiated for order ${orderNumber}`,
  refundCompleted: (orderNumber: string) => `Refund completed for order ${orderNumber}`,
  returnExchangeStatus: () => 'Update on your return or exchange request',
  abandonedCart: () => 'You left items in your Saree Grace cart',
};
