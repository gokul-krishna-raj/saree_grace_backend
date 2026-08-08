import { z } from 'zod';
import { Types } from 'mongoose';

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

export const addCartItemSchema = z.object({
  productId: objectId,
  variantId: objectId.nullable().optional(),
  qty: z.coerce.number().int().positive().default(1),
});

export const updateCartItemSchema = z.object({
  qty: z.coerce.number().int().positive(),
});

export const cartItemParamSchema = z.object({ itemId: objectId });

export const mergeGuestCartSchema = z.object({
  items: z
    .array(
      z.object({
        productId: objectId,
        variantId: objectId.nullable().optional(),
        qty: z.coerce.number().int().positive(),
      }),
    )
    .max(100),
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type MergeGuestCartInput = z.infer<typeof mergeGuestCartSchema>;
