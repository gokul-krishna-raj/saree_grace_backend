import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import * as shippingService from './shipping.service';
import { ShippingQuoteQuery } from './shipping.validation';

export const getShippingQuote = asyncHandler(async (req: Request, res: Response) => {
  const { pincode, state } = req.query as unknown as ShippingQuoteQuery;
  const quote = await shippingService.quoteShipping(pincode, state);
  sendSuccess(res, { quote });
});
