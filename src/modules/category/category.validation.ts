import { z } from 'zod';
import { Types } from 'mongoose';

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

// Requests now arrive as multipart/form-data (to carry the image file), so
// booleans come in as the strings "true"/"false" rather than JSON booleans.
const coercedBool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'string' ? v === 'true' : v));

export const createCategorySchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional(),
  parentCategory: objectId.nullable().optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).optional(),
  parentCategory: objectId.nullable().optional(),
  isActive: coercedBool.optional(),
  // Clears the existing image without uploading a replacement.
  removeImage: coercedBool.optional(),
});

export const categoryIdParamSchema = z.object({
  id: objectId,
});

export const listCategoriesQuerySchema = z.object({
  tree: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
