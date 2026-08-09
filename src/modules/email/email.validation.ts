import { z } from 'zod';

// Every send*Email() call validates its data against one of these before
// building a template — a missing/invalid recipient or required order field
// is a caller bug and fails fast rather than silently emailing nobody.
const recipientEmail = z.string().trim().email();
const nonEmptyString = z.string().trim().min(1);
const positiveNumber = z.number().min(0);

const lineItemSchema = z.object({
  name: nonEmptyString,
  image: z.string().optional(),
  qty: z.number().int().positive(),
  unitPrice: positiveNumber,
  subtotal: positiveNumber,
});

export const verificationEmailSchema = z.object({
  recipientEmail,
  customerName: nonEmptyString,
  verificationUrl: nonEmptyString,
});

export const passwordResetEmailSchema = z.object({
  recipientEmail,
  customerName: nonEmptyString,
  resetUrl: nonEmptyString,
  expiresInMinutes: z.number().positive(),
});

export const orderConfirmationEmailSchema = z.object({
  recipientEmail,
  userId: z.string().optional(),
  orderId: nonEmptyString,
  customerName: nonEmptyString,
  orderNumber: nonEmptyString,
  orderDate: z.date(),
  items: z.array(lineItemSchema).min(1),
  itemsTotal: positiveNumber,
  shippingFee: positiveNumber,
  discount: positiveNumber.optional(),
  tax: positiveNumber.optional(),
  total: positiveNumber,
  paymentMethod: z.string().optional(),
  paymentStatus: nonEmptyString,
  deliveryAddressLines: z.array(z.string()).min(1),
  estimatedDelivery: z.string().optional(),
  viewOrderUrl: nonEmptyString,
});

export const paymentSuccessEmailSchema = z.object({
  recipientEmail,
  userId: z.string().optional(),
  orderId: nonEmptyString,
  customerName: nonEmptyString,
  orderNumber: nonEmptyString,
  amount: positiveNumber,
  paymentMethod: z.string().optional(),
  transactionId: nonEmptyString,
  paymentDate: z.date(),
  viewOrderUrl: nonEmptyString,
});

export const paymentFailedEmailSchema = z.object({
  recipientEmail,
  userId: z.string().optional(),
  orderId: nonEmptyString,
  customerName: nonEmptyString,
  orderNumber: nonEmptyString,
  amount: positiveNumber,
  failureReason: z.string().optional(),
  retryPaymentUrl: nonEmptyString,
});

export const orderShippedEmailSchema = z.object({
  recipientEmail,
  userId: z.string().optional(),
  orderId: nonEmptyString,
  customerName: nonEmptyString,
  orderNumber: nonEmptyString,
  carrier: z.string().optional(),
  trackingId: z.string().optional(),
  trackingUrl: z.string().optional(),
  shippedDate: z.date(),
  estimatedDeliveryDate: z.string().optional(),
  viewOrderUrl: nonEmptyString,
});

export const orderDeliveredEmailSchema = z.object({
  recipientEmail,
  userId: z.string().optional(),
  orderId: nonEmptyString,
  customerName: nonEmptyString,
  orderNumber: nonEmptyString,
  deliveredDate: z.date(),
  viewOrderUrl: nonEmptyString,
  returnInfo: z.string().optional(),
  reviewUrl: z.string().optional(),
});

export const orderCancelledEmailSchema = z.object({
  recipientEmail,
  userId: z.string().optional(),
  orderId: nonEmptyString,
  customerName: nonEmptyString,
  orderNumber: nonEmptyString,
  cancelledItems: z
    .array(z.object({ name: nonEmptyString, qty: z.number().int().positive() }))
    .min(1),
  cancellationReason: z.string().optional(),
  cancelledDate: z.date(),
  refundAmount: positiveNumber.optional(),
  refundStatus: z.string().optional(),
});

export const refundInitiatedEmailSchema = z.object({
  recipientEmail,
  userId: z.string().optional(),
  orderId: nonEmptyString,
  customerName: nonEmptyString,
  orderNumber: nonEmptyString,
  refundAmount: positiveNumber,
  refundReason: z.string().optional(),
  refundReferenceId: nonEmptyString,
  refundStatus: nonEmptyString,
  expectedProcessing: z.string().optional(),
});

export const refundCompletedEmailSchema = z.object({
  recipientEmail,
  userId: z.string().optional(),
  orderId: nonEmptyString,
  customerName: nonEmptyString,
  orderNumber: nonEmptyString,
  refundAmount: positiveNumber,
  refundReferenceId: nonEmptyString,
  paymentMethod: z.string().optional(),
  completionDate: z.date(),
});

export const returnExchangeStatusEmailSchema = z.object({
  recipientEmail,
  userId: z.string().optional(),
  orderId: z.string().optional(),
  returnId: nonEmptyString,
  customerName: nonEmptyString,
  orderNumber: nonEmptyString,
  itemNames: z.array(nonEmptyString).min(1),
  status: z.enum(['requested', 'approved', 'rejected', 'picked_up', 'completed']),
  rejectionReason: z.string().optional(),
  nextSteps: nonEmptyString,
});

export const abandonedCartEmailSchema = z.object({
  recipientEmail,
  userId: z.string().optional(),
  cartId: nonEmptyString,
  cartUpdatedAtMs: z.number().positive(),
  customerName: nonEmptyString,
  items: z
    .array(
      z.object({
        name: nonEmptyString,
        image: z.string().optional(),
        price: positiveNumber,
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
  cartTotal: positiveNumber,
  cartUrl: nonEmptyString,
});
