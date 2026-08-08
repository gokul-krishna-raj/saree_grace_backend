import { z } from 'zod';
import { Types } from 'mongoose';

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

const coercedBool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'string' ? v === 'true' : v));

// Multipart form fields arrive as strings — coerce numbers/booleans/arrays.
export const createSimpleProductSchema = z.object({
  type: z.literal('simple'),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().min(1).max(5000),
  category: objectId,
  fabric: z.string().trim().max(100).optional(),
  color: z.string().trim().max(100).optional(),
  isHandloom: coercedBool.optional().default(false),
  price: z.coerce.number().positive(),
  compareAtPrice: z.coerce.number().positive().optional(),
  stock: z.coerce.number().int().min(0),
  sku: z.string().trim().toUpperCase().optional(),
});

export const createVariantShellProductSchema = z.object({
  type: z.literal('variant'),
  name: z.string().trim().min(2).max(200),
  description: z.string().trim().min(1).max(5000),
  category: objectId,
  fabric: z.string().trim().max(100).optional(),
  color: z.string().trim().max(100).optional(),
  isHandloom: coercedBool.optional().default(false),
  variantAttributeNames: z
    .union([z.array(z.string()), z.string()])
    .transform((v) =>
      Array.isArray(v)
        ? v
        : v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
    )
    .refine((arr) => arr.length > 0, 'At least one variant attribute name is required'),
});

export const createProductSchema = z.discriminatedUnion('type', [
  createSimpleProductSchema,
  createVariantShellProductSchema,
]);

export const updateProductSchema = z.object({
  name: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().min(1).max(5000).optional(),
  category: objectId.optional(),
  fabric: z.string().trim().max(100).optional(),
  color: z.string().trim().max(100).optional(),
  isHandloom: coercedBool.optional(),
  price: z.coerce.number().positive().optional(),
  compareAtPrice: z.coerce.number().positive().optional(),
  stock: z.coerce.number().int().min(0).optional(),
  sku: z.string().trim().toUpperCase().optional(),
  isActive: coercedBool.optional(),
  removeImagePublicIds: z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
});

export const addVariantSchema = z.object({
  sku: z.string().trim().min(1).toUpperCase(),
  attributes: z
    .union([z.record(z.string()), z.string()])
    .transform((v) => (typeof v === 'string' ? (JSON.parse(v) as Record<string, string>) : v)),
  price: z.coerce.number().positive(),
  compareAtPrice: z.coerce.number().positive().optional(),
  stock: z.coerce.number().int().min(0),
});

export const updateVariantSchema = z.object({
  sku: z.string().trim().min(1).toUpperCase().optional(),
  attributes: z
    .union([z.record(z.string()), z.string()])
    .transform((v) => (typeof v === 'string' ? (JSON.parse(v) as Record<string, string>) : v))
    .optional(),
  price: z.coerce.number().positive().optional(),
  compareAtPrice: z.coerce.number().positive().optional(),
  stock: z.coerce.number().int().min(0).optional(),
  isActive: coercedBool.optional(),
  removeImagePublicIds: z
    .union([z.array(z.string()), z.string()])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .optional(),
});

export const productIdParamSchema = z.object({ id: objectId });
export const variantParamSchema = z.object({ id: objectId, variantId: objectId });
export const slugParamSchema = z.object({ slug: z.string().min(1) });

export const listProductsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
  category: objectId.optional(),
  fabric: z.string().optional(),
  color: z.string().optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().nonnegative().optional(),
  handloomOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  inStockOnly: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  sort: z.enum(['newest', 'price_asc', 'price_desc', 'top_rated']).optional().default('newest'),
});

export const searchProductsQuerySchema = z.object({
  q: z.string().trim().min(1),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export type CreateSimpleProductInput = z.infer<typeof createSimpleProductSchema>;
export type CreateVariantShellInput = z.infer<typeof createVariantShellProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type AddVariantInput = z.infer<typeof addVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type ListProductsQuery = z.infer<typeof listProductsQuerySchema>;
