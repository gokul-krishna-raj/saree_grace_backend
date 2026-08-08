import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import * as cartService from './cart.service';
import { AddCartItemInput, MergeGuestCartInput, UpdateCartItemInput } from './cart.validation';

function requireUserId(req: Request): string {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.id;
}

export const getCart = asyncHandler(async (req: Request, res: Response) => {
  const cart = await cartService.getCart(requireUserId(req));
  sendSuccess(res, { cart });
});

export const addItem = asyncHandler(async (req: Request, res: Response) => {
  const cart = await cartService.addItemToCart(requireUserId(req), req.body as AddCartItemInput);
  sendSuccess(res, { cart }, 201);
});

export const updateItem = asyncHandler(async (req: Request, res: Response) => {
  const cart = await cartService.updateCartItem(
    requireUserId(req),
    req.params.itemId as string,
    req.body as UpdateCartItemInput,
  );
  sendSuccess(res, { cart });
});

export const removeItem = asyncHandler(async (req: Request, res: Response) => {
  const cart = await cartService.removeCartItem(requireUserId(req), req.params.itemId as string);
  sendSuccess(res, { cart });
});

/**
 * Called right after login by a frontend that kept a guest/anonymous cart
 * in localStorage — merges those items into the now-authenticated user's
 * persisted cart. The guest cart itself lives entirely client-side; the
 * backend has no anonymous cart storage.
 */
export const mergeGuestCart = asyncHandler(async (req: Request, res: Response) => {
  const { items } = req.body as MergeGuestCartInput;
  const cart = await cartService.mergeGuestCartIntoUserCart(requireUserId(req), items);
  sendSuccess(res, { cart });
});
