import { z } from 'zod';

// Indian PIN codes are 6 digits and never start with 0.
export const pincodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit pincode');

export const shippingQuoteQuerySchema = z.object({
  pincode: pincodeSchema,
  state: z.string().trim().min(2).max(100).optional(),
});

export type ShippingQuoteQuery = z.infer<typeof shippingQuoteQuerySchema>;
