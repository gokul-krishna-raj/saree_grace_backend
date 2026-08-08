import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import * as reviewService from './review.service';
import { AdminListReviewsQuery, CreateReviewInput, ListReviewsQuery } from './review.validation';

function requireUserId(req: Request): string {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.id;
}

function filesFromRequest(req: Request): Express.Multer.File[] {
  return Array.isArray(req.files) ? req.files : [];
}

export const createReview = asyncHandler(async (req: Request, res: Response) => {
  const review = await reviewService.createReview(
    requireUserId(req),
    req.body as CreateReviewInput,
    filesFromRequest(req),
  );
  sendSuccess(res, { review }, 201);
});

export const listReviewsForProduct = asyncHandler(async (req: Request, res: Response) => {
  const result = await reviewService.listApprovedReviewsForProduct(
    req.params.id as string,
    req.query as unknown as ListReviewsQuery,
  );
  sendSuccess(res, { reviews: result.reviews }, 200, { nextCursor: result.nextCursor });
});

export const adminListReviews = asyncHandler(async (req: Request, res: Response) => {
  const result = await reviewService.adminListReviews(
    req.query as unknown as AdminListReviewsQuery,
  );
  sendSuccess(res, { reviews: result.reviews }, 200, { nextCursor: result.nextCursor });
});

export const adminApproveReview = asyncHandler(async (req: Request, res: Response) => {
  const review = await reviewService.approveReview(req.params.id as string);
  sendSuccess(res, { review });
});

export const adminDeleteReview = asyncHandler(async (req: Request, res: Response) => {
  await reviewService.deleteReview(req.params.id as string);
  sendSuccess(res, { message: 'Review deleted' });
});
