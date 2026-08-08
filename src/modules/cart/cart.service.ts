import { Types } from 'mongoose';
import { Cart, CartDocument } from '../../models/Cart';
import { Product } from '../../models/Product';
import { ApiError } from '../../utils/ApiError';
import { AddCartItemInput, UpdateCartItemInput } from './cart.validation';

interface ResolvedItem {
  price: number;
  name: string;
  image?: string;
  stock: number;
}

async function resolveProductAndVariant(
  productId: string,
  variantId: string | null | undefined,
): Promise<ResolvedItem> {
  const product = await Product.findOne({ _id: productId, isActive: true });
  if (!product) {
    throw ApiError.notFound('Product not found');
  }

  if (product.type === 'variant') {
    if (!variantId) {
      throw ApiError.badRequest('variantId is required for variant products');
    }
    const variant = product.variants.find((v) => v._id.toString() === variantId && v.isActive);
    if (!variant) {
      throw ApiError.notFound('Variant not found');
    }
    return {
      price: variant.price,
      name: product.name,
      image: variant.images[0]?.url ?? product.images[0]?.url,
      stock: variant.stock,
    };
  }

  return {
    price: product.price ?? 0,
    name: product.name,
    image: product.images[0]?.url,
    stock: product.stock ?? 0,
  };
}

async function getOrCreateCart(userId: string): Promise<CartDocument> {
  let cart = await Cart.findOne({ user: userId });
  if (!cart) {
    cart = await Cart.create({ user: userId, items: [] });
  }
  return cart;
}

export async function getCart(userId: string): Promise<CartDocument> {
  return getOrCreateCart(userId);
}

export async function addItemToCart(
  userId: string,
  input: AddCartItemInput,
): Promise<CartDocument> {
  const resolved = await resolveProductAndVariant(input.productId, input.variantId ?? null);
  if (resolved.stock < input.qty) {
    throw ApiError.conflict('Requested quantity exceeds available stock');
  }

  const cart = await getOrCreateCart(userId);
  const existing = cart.items.find(
    (item) =>
      item.product.toString() === input.productId &&
      (item.variantId?.toString() ?? null) === (input.variantId ?? null),
  );

  if (existing) {
    const newQty = existing.qty + input.qty;
    if (newQty > resolved.stock) {
      throw ApiError.conflict('Requested quantity exceeds available stock');
    }
    existing.qty = newQty;
    // Refresh price snapshot to the current live price on every add — this is
    // the documented behavior (see CLAUDE.md "Cart pricing"): the snapshot
    // moves forward each time the item is touched, but never silently drifts
    // between touches.
    existing.priceSnapshot = resolved.price;
  } else {
    cart.items.push({
      _id: new Types.ObjectId(),
      product: new Types.ObjectId(input.productId),
      variantId: input.variantId ? new Types.ObjectId(input.variantId) : null,
      qty: input.qty,
      priceSnapshot: resolved.price,
      nameSnapshot: resolved.name,
      imageSnapshot: resolved.image,
    });
  }

  await cart.save();
  return cart;
}

export async function updateCartItem(
  userId: string,
  itemId: string,
  input: UpdateCartItemInput,
): Promise<CartDocument> {
  const cart = await getOrCreateCart(userId);
  const item = cart.items.find((i) => i._id.toString() === itemId);
  if (!item) {
    throw ApiError.notFound('Cart item not found');
  }

  const resolved = await resolveProductAndVariant(
    item.product.toString(),
    item.variantId?.toString() ?? null,
  );
  if (input.qty > resolved.stock) {
    throw ApiError.conflict('Requested quantity exceeds available stock');
  }

  item.qty = input.qty;
  item.priceSnapshot = resolved.price;
  await cart.save();
  return cart;
}

export async function removeCartItem(userId: string, itemId: string): Promise<CartDocument> {
  const cart = await getOrCreateCart(userId);
  const originalLength = cart.items.length;
  cart.items = cart.items.filter((i) => i._id.toString() !== itemId) as typeof cart.items;
  if (cart.items.length === originalLength) {
    throw ApiError.notFound('Cart item not found');
  }
  await cart.save();
  return cart;
}

/**
 * Merges a guest cart's items into the authenticated user's cart on login.
 * Quantities for matching product+variant combinations are summed (capped
 * at available stock); the guest cart is discarded afterward.
 */
export async function mergeGuestCartIntoUserCart(
  userId: string,
  guestItems: Array<{ productId: string; variantId?: string | null; qty: number }>,
): Promise<CartDocument> {
  const cart = await getOrCreateCart(userId);

  for (const guestItem of guestItems) {
    try {
      const resolved = await resolveProductAndVariant(
        guestItem.productId,
        guestItem.variantId ?? null,
      );
      const existing = cart.items.find(
        (item) =>
          item.product.toString() === guestItem.productId &&
          (item.variantId?.toString() ?? null) === (guestItem.variantId ?? null),
      );
      if (existing) {
        existing.qty = Math.min(existing.qty + guestItem.qty, resolved.stock);
        existing.priceSnapshot = resolved.price;
      } else {
        cart.items.push({
          _id: new Types.ObjectId(),
          product: new Types.ObjectId(guestItem.productId),
          variantId: guestItem.variantId ? new Types.ObjectId(guestItem.variantId) : null,
          qty: Math.min(guestItem.qty, resolved.stock),
          priceSnapshot: resolved.price,
          nameSnapshot: resolved.name,
          imageSnapshot: resolved.image,
        });
      }
    } catch {
      // Skip guest items referencing products/variants that no longer exist.
      continue;
    }
  }

  await cart.save();
  return cart;
}

export async function clearCart(userId: string): Promise<void> {
  await Cart.updateOne({ user: userId }, { $set: { items: [] } });
}
