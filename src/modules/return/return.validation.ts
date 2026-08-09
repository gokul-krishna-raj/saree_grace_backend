import { z } from 'zod';
import { Types } from 'mongoose';

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

export const createReturnRequestSchema = z.object({
  orderId: objectId,
  type: z.enum(['return', 'exchange']),
  items: z
    .array(
      z.object({
        product: objectId,
        variantId: objectId.nullable().optional(),
        qty: z.number().int().positive(),
      }),
    )
    .min(1),
  reason: z.string().trim().min(3).max(500),
});

export const returnIdParamSchema = z.object({ id: objectId });

export const updateReturnStatusSchema = z.object({
  status: z.enum(['approved', 'rejected', 'picked_up', 'completed']),
  adminNote: z.string().trim().max(500).optional(),
});

export const listReturnsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  status: z.enum(['requested', 'approved', 'rejected', 'picked_up', 'completed']).optional(),
});

export type CreateReturnRequestInput = z.infer<typeof createReturnRequestSchema>;
export type UpdateReturnStatusInput = z.infer<typeof updateReturnStatusSchema>;
export type ListReturnsQuery = z.infer<typeof listReturnsQuerySchema>;
