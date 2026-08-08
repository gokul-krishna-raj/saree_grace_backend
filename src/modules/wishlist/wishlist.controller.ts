import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import * as wishlistService from './wishlist.service';

function requireUserId(req: Request): string {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.id;
}

export const getWishlist = asyncHandler(async (req: Request, res: Response) => {
  const wishlist = await wishlistService.getWishlist(requireUserId(req));
  sendSuccess(res, { wishlist });
});

export const addToWishlist = asyncHandler(async (req: Request, res: Response) => {
  const wishlist = await wishlistService.addToWishlist(
    requireUserId(req),
    req.params.productId as string,
  );
  sendSuccess(res, { wishlist }, 201);
});

export const removeFromWishlist = asyncHandler(async (req: Request, res: Response) => {
  const wishlist = await wishlistService.removeFromWishlist(
    requireUserId(req),
    req.params.productId as string,
  );
  sendSuccess(res, { wishlist });
});
