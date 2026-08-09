import { ReturnStatus } from '../../models/ReturnRequest';

export interface EmailLineItem {
  name: string;
  image?: string;
  qty: number;
  unitPrice: number;
  subtotal: number;
}

export interface VerificationEmailData {
  recipientEmail: string;
  customerName: string;
  verificationUrl: string;
}

export interface PasswordResetEmailData {
  recipientEmail: string;
  customerName: string;
  resetUrl: string;
  expiresInMinutes: number;
}

export interface OrderConfirmationEmailData {
  recipientEmail: string;
  userId?: string;
  orderId: string;
  customerName: string;
  orderNumber: string;
  orderDate: Date;
  items: EmailLineItem[];
  itemsTotal: number;
  shippingFee: number;
  discount?: number;
  tax?: number;
  total: number;
  paymentMethod?: string;
  paymentStatus: string;
  deliveryAddressLines: string[];
  estimatedDelivery?: string;
  viewOrderUrl: string;
}

export interface PaymentSuccessEmailData {
  recipientEmail: string;
  userId?: string;
  orderId: string;
  customerName: string;
  orderNumber: string;
  amount: number;
  paymentMethod?: string;
  transactionId: string;
  paymentDate: Date;
  viewOrderUrl: string;
}

export interface PaymentFailedEmailData {
  recipientEmail: string;
  userId?: string;
  orderId: string;
  customerName: string;
  orderNumber: string;
  amount: number;
  failureReason?: string;
  retryPaymentUrl: string;
}

export interface OrderShippedEmailData {
  recipientEmail: string;
  userId?: string;
  orderId: string;
  customerName: string;
  orderNumber: string;
  carrier?: string;
  trackingId?: string;
  trackingUrl?: string;
  shippedDate: Date;
  estimatedDeliveryDate?: string;
  viewOrderUrl: string;
}

export interface OrderDeliveredEmailData {
  recipientEmail: string;
  userId?: string;
  orderId: string;
  customerName: string;
  orderNumber: string;
  deliveredDate: Date;
  viewOrderUrl: string;
  returnInfo?: string;
  reviewUrl?: string;
}

export interface OrderCancelledEmailData {
  recipientEmail: string;
  userId?: string;
  orderId: string;
  customerName: string;
  orderNumber: string;
  cancelledItems: { name: string; qty: number }[];
  cancellationReason?: string;
  cancelledDate: Date;
  refundAmount?: number;
  refundStatus?: string;
}

export interface RefundInitiatedEmailData {
  recipientEmail: string;
  userId?: string;
  orderId: string;
  customerName: string;
  orderNumber: string;
  refundAmount: number;
  refundReason?: string;
  refundReferenceId: string;
  refundStatus: string;
  expectedProcessing?: string;
}

export interface RefundCompletedEmailData {
  recipientEmail: string;
  userId?: string;
  orderId: string;
  customerName: string;
  orderNumber: string;
  refundAmount: number;
  refundReferenceId: string;
  paymentMethod?: string;
  completionDate: Date;
}

export interface ReturnExchangeStatusEmailData {
  recipientEmail: string;
  userId?: string;
  orderId?: string;
  returnId: string;
  customerName: string;
  orderNumber: string;
  itemNames: string[];
  status: ReturnStatus;
  rejectionReason?: string;
  nextSteps: string;
}

export interface AbandonedCartEmailData {
  recipientEmail: string;
  userId?: string;
  cartId: string;
  // Cart's updatedAt, in ms — part of the idempotency key so a reminder is
  // sent once per cart "state" and only re-eligible once the cart is
  // touched again and goes idle for another full window.
  cartUpdatedAtMs: number;
  customerName: string;
  items: { name: string; image?: string; price: number; qty: number }[];
  cartTotal: number;
  cartUrl: string;
}

export interface EmailResult {
  skipped: boolean;
  sent: boolean;
  error?: string;
}
