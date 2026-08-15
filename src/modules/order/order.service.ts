import mongoose from 'mongoose';
import crypto from 'crypto';
import { Cart } from '../../models/Cart';
import { Product } from '../../models/Product';
import { Order, OrderDocument, OrderStatus } from '../../models/Order';
import { ApiError } from '../../utils/ApiError';
import { clampLimit, decodeCursor, encodeCursor } from '../../utils/pagination';
import { assertValidTransition, STOCK_RESTORING_STATUSES } from './orderStateMachine';
import { restoreStock } from '../product/product.service';
import { CreateOrderInput, ListOrdersQuery, UpdateOrderStatusInput } from './order.validation';
import { triggerOrderConfirmationEmail, triggerOrderStatusEmail } from '../email/email.events';

// State-tiered shipping: cheapest for Tamil Nadu (home state), a mid tier for the
// neighboring South Indian states, flat rate elsewhere. Keyed lowercase/trimmed so
// casing differences between clients never fall through to the default tier.
const SHIPPING_FEE_BY_STATE: Record<string, number> = {
  'tamil nadu': 40,
  kerala: 60,
  'andhra pradesh': 60,
  karnataka: 60,
};
const DEFAULT_SHIPPING_FEE = 130;

function computeShippingFee(state: string): number {
  return SHIPPING_FEE_BY_STATE[state.trim().toLowerCase()] ?? DEFAULT_SHIPPING_FEE;
}

function generateOrderNumber(): string {
  const time = Date.now().toString(36).toUpperCase();
  const random = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `SG-${time}-${random}`;
}

export async function createOrderFromCart(
  userId: string,
  input: CreateOrderInput,
): Promise<OrderDocument> {
  const cart = await Cart.findOne({ user: userId });
  if (!cart || cart.items.length === 0) {
    throw ApiError.badRequest('Cart is empty');
  }

  const session = await mongoose.startSession();
  let createdOrder: OrderDocument | null = null;

  try {
    await session.withTransaction(async () => {
      // Stock is reserved by decrementing it immediately and atomically per
      // item, inside the transaction — if any item is short on stock the
      // whole transaction aborts and nothing is decremented.
      for (const item of cart.items) {
        const variantId = item.variantId ? item.variantId.toString() : null;
        const filter: Record<string, unknown> = variantId
          ? { _id: item.product, 'variants._id': variantId, 'variants.stock': { $gte: item.qty } }
          : { _id: item.product, stock: { $gte: item.qty } };
        const update = variantId
          ? { $inc: { 'variants.$.stock': -item.qty } }
          : { $inc: { stock: -item.qty } };

        const result = await Product.updateOne(filter, update, { session });
        if (result.matchedCount === 0) {
          throw ApiError.conflict(`Insufficient stock for "${item.nameSnapshot}"`);
        }
      }

      const itemsTotal = cart.items.reduce((sum, item) => sum + item.priceSnapshot * item.qty, 0);
      const shippingFee = computeShippingFee(input.shippingAddress.state);
      const total = itemsTotal + shippingFee;

      const [order] = await Order.create(
        [
          {
            orderNumber: generateOrderNumber(),
            user: userId,
            items: cart.items.map((item) => ({
              product: item.product,
              variantId: item.variantId,
              nameSnapshot: item.nameSnapshot,
              imageSnapshot: item.imageSnapshot,
              priceSnapshot: item.priceSnapshot,
              qty: item.qty,
            })),
            shippingAddress: input.shippingAddress,
            itemsTotal,
            shippingFee,
            total,
            status: 'pending',
            statusHistory: [{ status: 'pending', changedAt: new Date() }],
          },
        ],
        { session },
      );
      createdOrder = order as OrderDocument;

      cart.items = [] as typeof cart.items;
      await cart.save({ session });
    });
  } finally {
    await session.endSession();
  }

  if (!createdOrder) {
    throw ApiError.internal('Order creation failed unexpectedly');
  }
  await triggerOrderConfirmationEmail(createdOrder);
  return createdOrder;
}

export async function getOrderByIdForUser(orderId: string, userId: string): Promise<OrderDocument> {
  const order = await Order.findById(orderId);
  if (!order) {
    throw ApiError.notFound('Order not found');
  }
  if (order.user.toString() !== userId) {
    throw ApiError.forbidden('You do not have access to this order');
  }
  return order;
}

export async function getOrderByIdForAdmin(orderId: string): Promise<OrderDocument> {
  const order = await Order.findById(orderId).populate({
    path: 'items.product',
    select: 'name category type',
    populate: { path: 'category', select: 'name' },
  });
  if (!order) {
    throw ApiError.notFound('Order not found');
  }
  return order;
}

export interface OrderListResult {
  orders: OrderDocument[];
  nextCursor: string | null;
}

export async function listOrdersForUser(
  userId: string,
  query: ListOrdersQuery,
): Promise<OrderListResult> {
  const limit = clampLimit(query.limit);
  const filter: Record<string, unknown> = { user: userId };
  if (query.status) filter.status = query.status;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (!decoded) throw ApiError.badRequest('Invalid pagination cursor');
    filter._id = { $lt: decoded };
  }

  const orders = await Order.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1);
  const hasMore = orders.length > limit;
  const page = hasMore ? orders.slice(0, limit) : orders;
  const last = page[page.length - 1];
  return { orders: page, nextCursor: hasMore && last ? encodeCursor(last._id) : null };
}

export async function listAllOrders(query: ListOrdersQuery): Promise<OrderListResult> {
  const limit = clampLimit(query.limit);
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (!decoded) throw ApiError.badRequest('Invalid pagination cursor');
    filter._id = { $lt: decoded };
  }

  const orders = await Order.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('user', 'name email');
  const hasMore = orders.length > limit;
  const page = hasMore ? orders.slice(0, limit) : orders;
  const last = page[page.length - 1];
  return { orders: page, nextCursor: hasMore && last ? encodeCursor(last._id) : null };
}

async function releaseStockForOrder(order: OrderDocument): Promise<void> {
  if (order.stockRestored) return;
  for (const item of order.items) {
    await restoreStock(
      item.product.toString(),
      item.variantId ? item.variantId.toString() : null,
      item.qty,
    );
  }
  order.stockRestored = true;
}

/**
 * Single choke point for every status change — used by the customer cancel
 * endpoint, the admin status endpoint, the payment verify endpoint, and the
 * webhook handler, so the state machine and history log are never bypassed.
 */
export async function transitionOrderStatus(
  order: OrderDocument,
  to: OrderStatus,
  options: {
    note?: string;
    changedBy?: string;
    carrier?: string;
    trackingId?: string;
    trackingUrl?: string;
  } = {},
): Promise<OrderDocument> {
  assertValidTransition(order.status, to);

  order.status = to;
  order.statusHistory.push({
    status: to,
    note: options.note,
    changedAt: new Date(),
    changedBy: options.changedBy as unknown as OrderDocument['statusHistory'][number]['changedBy'],
  });

  if (options.carrier !== undefined) order.tracking.carrier = options.carrier;
  if (options.trackingId !== undefined) order.tracking.trackingId = options.trackingId;
  if (options.trackingUrl !== undefined) order.tracking.trackingUrl = options.trackingUrl;

  if (STOCK_RESTORING_STATUSES.includes(to)) {
    await releaseStockForOrder(order);
  }

  await order.save();
  await triggerOrderStatusEmail(order, to);
  return order;
}

export async function cancelOwnOrder(orderId: string, userId: string): Promise<OrderDocument> {
  const order = await getOrderByIdForUser(orderId, userId);
  if (!['pending', 'paid', 'processing'].includes(order.status)) {
    throw ApiError.conflict(`Order in status "${order.status}" can no longer be cancelled`);
  }
  return transitionOrderStatus(order, 'cancelled', {
    changedBy: userId,
    note: 'Cancelled by customer',
  });
}

export async function adminUpdateOrderStatus(
  orderId: string,
  input: UpdateOrderStatusInput,
  adminId: string,
): Promise<OrderDocument> {
  const order = await getOrderByIdForAdmin(orderId);
  return transitionOrderStatus(order, input.status, {
    note: input.note,
    changedBy: adminId,
    carrier: input.carrier,
    trackingId: input.trackingId,
    trackingUrl: input.trackingUrl,
  });
}
