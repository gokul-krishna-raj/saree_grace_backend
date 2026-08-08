import { Wishlist, WishlistDocument } from '../../models/Wishlist';
import { Product } from '../../models/Product';
import { ApiError } from '../../utils/ApiError';

async function getOrCreateWishlist(userId: string): Promise<WishlistDocument> {
  let wishlist = await Wishlist.findOne({ user: userId });
  if (!wishlist) {
    wishlist = await Wishlist.create({ user: userId, productIds: [] });
  }
  return wishlist;
}

export async function getWishlist(userId: string): Promise<WishlistDocument> {
  const wishlist = await getOrCreateWishlist(userId);
  await wishlist.populate('productIds', 'name slug images price variants type isActive');
  return wishlist;
}

export async function addToWishlist(userId: string, productId: string): Promise<WishlistDocument> {
  const product = await Product.findOne({ _id: productId, isActive: true });
  if (!product) {
    throw ApiError.notFound('Product not found');
  }

  // $addToSet makes a duplicate add a no-op instead of an error/duplicate entry.
  const wishlist = await Wishlist.findOneAndUpdate(
    { user: userId },
    { $addToSet: { productIds: productId } },
    { upsert: true, new: true },
  );
  return wishlist as WishlistDocument;
}

export async function removeFromWishlist(
  userId: string,
  productId: string,
): Promise<WishlistDocument> {
  const wishlist = await Wishlist.findOneAndUpdate(
    { user: userId },
    { $pull: { productIds: productId } },
    { upsert: true, new: true },
  );
  return wishlist as WishlistDocument;
}
