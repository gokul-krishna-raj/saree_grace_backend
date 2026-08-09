import { z } from 'zod';
import { Types } from 'mongoose';

const objectId = z.string().refine((v) => Types.ObjectId.isValid(v), { message: 'Invalid id' });

// Requests arrive as multipart/form-data (to carry the image file), so
// booleans come in as the strings "true"/"false" rather than JSON booleans.
const coercedBool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'string' ? v === 'true' : v));

export const createOccasionSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional(),
});

export const updateOccasionSchema = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  description: z.string().trim().max(1000).optional(),
  isActive: coercedBool.optional(),
  // Clears the existing image without uploading a replacement.
  removeImage: coercedBool.optional(),
});

export const occasionIdParamSchema = z.object({
  id: objectId,
});

export type CreateOccasionInput = z.infer<typeof createOccasionSchema>;
export type UpdateOccasionInput = z.infer<typeof updateOccasionSchema>;
