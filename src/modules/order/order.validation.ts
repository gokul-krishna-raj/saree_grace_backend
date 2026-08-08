import { z } from 'zod';
import { Types } from 'mongoose';

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

export const addressInputSchema = z.object({
  label: z.string().trim().max(50).optional(),
  fullName: z.string().trim().min(2).max(100),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+\-\s]{7,15}$/, 'Invalid phone number'),
  line1: z.string().trim().min(2).max(200),
  line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(100),
  state: z.string().trim().min(2).max(100),
  postalCode: z.string().trim().min(3).max(15),
  country: z.string().trim().min(2).max(100).default('India'),
  isDefault: z.boolean().optional().default(false),
});

export const createOrderSchema = z.object({
  shippingAddress: addressInputSchema,
});

export const orderIdParamSchema = z.object({ id: objectId });

export const updateOrderStatusSchema = z.object({
  status: z.enum(['paid', 'processing', 'shipped', 'delivered', 'cancelled', 'payment_failed']),
  note: z.string().trim().max(500).optional(),
  carrier: z.string().trim().max(100).optional(),
  trackingId: z.string().trim().max(100).optional(),
  trackingUrl: z.string().trim().url().optional(),
});

export const listOrdersQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: z
    .enum(['pending', 'paid', 'processing', 'shipped', 'delivered', 'cancelled', 'payment_failed'])
    .optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type ListOrdersQuery = z.infer<typeof listOrdersQuerySchema>;
