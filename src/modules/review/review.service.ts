import { Types } from 'mongoose';
import { Review, ReviewDocument } from '../../models/Review';
import { Order } from '../../models/Order';
import { Product } from '../../models/Product';
import { ApiError } from '../../utils/ApiError';
import { clampLimit, decodeCursor, encodeCursor } from '../../utils/pagination';
import { uploadBufferToCloudinary, deleteCloudinaryImages } from '../../utils/cloudinaryUpload';
import { CreateReviewInput, AdminListReviewsQuery, ListReviewsQuery } from './review.validation';

async function recalcProductRating(productId: string): Promise<void> {
  const [stats] = await Review.aggregate<{ _id: null; avg: number; count: number }>([
    { $match: { product: new Types.ObjectId(productId), approved: true } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  await Product.updateOne(
    { _id: productId },
    {
      ratingAvg: stats ? Math.round(stats.avg * 10) / 10 : 0,
      reviewCount: stats ? stats.count : 0,
    },
  );
}

export async function createReview(
  userId: string,
  input: CreateReviewInput,
  files: Express.Multer.File[],
): Promise<ReviewDocument> {
  const order = await Order.findById(input.orderId);
  if (!order || order.user.toString() !== userId) {
    throw ApiError.forbidden('You can only review products from your own orders');
  }
  if (order.status !== 'delivered') {
    throw ApiError.badRequest('You can only review products from delivered orders');
  }
  const purchasedThisProduct = order.items.some(
    (item) => item.product.toString() === input.productId,
  );
  if (!purchasedThisProduct) {
    throw ApiError.badRequest('This product was not part of the specified order');
  }

  const existing = await Review.findOne({
    user: userId,
    product: input.productId,
    order: input.orderId,
  });
  if (existing) {
    throw ApiError.conflict('You have already reviewed this product for this order');
  }

  const images =
    files.length > 0
      ? (await Promise.all(files.map((f) => uploadBufferToCloudinary(f.buffer)))).map((u) => ({
          url: u.url,
          publicId: u.publicId,
        }))
      : [];

  return Review.create({
    user: userId,
    product: input.productId,
    order: input.orderId,
    rating: input.rating,
    comment: input.comment,
    images,
    approved: false,
  });
}

export interface ReviewListResult {
  reviews: ReviewDocument[];
  nextCursor: string | null;
}

export async function listApprovedReviewsForProduct(
  productId: string,
  query: ListReviewsQuery,
): Promise<ReviewListResult> {
  const limit = clampLimit(query.limit);
  const filter: Record<string, unknown> = { product: productId, approved: true };
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (!decoded) throw ApiError.badRequest('Invalid pagination cursor');
    filter._id = { $lt: decoded };
  }

  const reviews = await Review.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('user', 'name');

  const hasMore = reviews.length > limit;
  const page = hasMore ? reviews.slice(0, limit) : reviews;
  const last = page[page.length - 1];
  return { reviews: page, nextCursor: hasMore && last ? encodeCursor(last._id) : null };
}

export async function adminListReviews(query: AdminListReviewsQuery): Promise<ReviewListResult> {
  const limit = clampLimit(query.limit);
  const filter: Record<string, unknown> = {};
  if (query.approved !== undefined) filter.approved = query.approved;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (!decoded) throw ApiError.badRequest('Invalid pagination cursor');
    filter._id = { $lt: decoded };
  }

  const reviews = await Review.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('user', 'name email')
    .populate('product', 'name slug');

  const hasMore = reviews.length > limit;
  const page = hasMore ? reviews.slice(0, limit) : reviews;
  const last = page[page.length - 1];
  return { reviews: page, nextCursor: hasMore && last ? encodeCursor(last._id) : null };
}

export async function approveReview(reviewId: string): Promise<ReviewDocument> {
  const review = await Review.findById(reviewId);
  if (!review) {
    throw ApiError.notFound('Review not found');
  }
  if (!review.approved) {
    review.approved = true;
    await review.save();
    await recalcProductRating(review.product.toString());
  }
  return review;
}

export async function deleteReview(reviewId: string): Promise<void> {
  const review = await Review.findById(reviewId);
  if (!review) {
    throw ApiError.notFound('Review not found');
  }
  const wasApproved = review.approved;
  const productId = review.product.toString();

  await deleteCloudinaryImages(review.images.map((img) => img.publicId));
  await review.deleteOne();

  if (wasApproved) {
    await recalcProductRating(productId);
  }
}
