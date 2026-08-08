import { z } from 'zod';
import { Types } from 'mongoose';

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

export const createPaymentOrderSchema = z.object({
  orderId: objectId,
});

export const verifyPaymentSchema = z.object({
  razorpayOrderId: z.string().min(1),
  razorpayPaymentId: z.string().min(1),
  razorpaySignature: z.string().min(1),
});

export const refundOrderSchema = z.object({
  amount: z.coerce.number().positive().optional(),
  reason: z.string().trim().max(500).optional(),
});

export const orderIdParamSchema = z.object({ id: objectId });

export type CreatePaymentOrderInput = z.infer<typeof createPaymentOrderSchema>;
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;
export type RefundOrderInput = z.infer<typeof refundOrderSchema>;
