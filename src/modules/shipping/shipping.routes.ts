import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import * as shippingController from './shipping.controller';
import { shippingQuoteQuerySchema } from './shipping.validation';

const router = Router();

// Public — checkout previews the fee before the order exists. The order itself re-quotes
// server-side, so this endpoint is never trusted for the amount charged.
router.get(
  '/quote',
  validate({ query: shippingQuoteQuerySchema }),
  shippingController.getShippingQuote,
);

export default router;
