import { Order, OrderDocument } from '../../models/Order';
import { ReturnRequest, ReturnRequestDocument } from '../../models/ReturnRequest';
import { ApiError } from '../../utils/ApiError';
import { clampLimit, decodeCursor, encodeCursor } from '../../utils/pagination';
import { assertValidReturnTransition } from './returnStateMachine';
import { triggerReturnStatusEmail } from '../email/email.events';
import {
  CreateReturnRequestInput,
  ListReturnsQuery,
  UpdateReturnStatusInput,
} from './return.validation';

async function getDeliveredOrderForUser(orderId: string, userId: string): Promise<OrderDocument> {
  const order = await Order.findById(orderId);
  if (!order) {
    throw ApiError.notFound('Order not found');
  }
  if (order.user.toString() !== userId) {
    throw ApiError.forbidden('You do not have access to this order');
  }
  if (order.status !== 'delivered') {
    throw ApiError.conflict('Only delivered orders are eligible for return or exchange');
  }
  return order;
}

export async function createReturnRequest(
  userId: string,
  input: CreateReturnRequestInput,
): Promise<ReturnRequestDocument> {
  const order = await getDeliveredOrderForUser(input.orderId, userId);

  const items = input.items.map((requested) => {
    const orderItem = order.items.find(
      (item) =>
        item.product.toString() === requested.product &&
        (item.variantId ? item.variantId.toString() : null) === (requested.variantId ?? null),
    );
    if (!orderItem) {
      throw ApiError.badRequest('One or more items were not part of this order');
    }
    if (requested.qty > orderItem.qty) {
      throw ApiError.badRequest(`Cannot request ${requested.qty} of "${orderItem.nameSnapshot}"`);
    }
    return {
      product: orderItem.product,
      variantId: orderItem.variantId,
      nameSnapshot: orderItem.nameSnapshot,
      qty: requested.qty,
    };
  });

  const returnRequest = await ReturnRequest.create({
    order: order._id,
    user: userId,
    type: input.type,
    items,
    reason: input.reason,
    status: 'requested',
    statusHistory: [{ status: 'requested', changedAt: new Date() }],
  });

  await triggerReturnStatusEmail(returnRequest, order);
  return returnRequest;
}

export async function getReturnByIdForUser(
  returnId: string,
  userId: string,
): Promise<ReturnRequestDocument> {
  const returnRequest = await ReturnRequest.findById(returnId);
  if (!returnRequest) {
    throw ApiError.notFound('Return request not found');
  }
  if (returnRequest.user.toString() !== userId) {
    throw ApiError.forbidden('You do not have access to this return request');
  }
  return returnRequest;
}

export async function getReturnByIdForAdmin(returnId: string): Promise<ReturnRequestDocument> {
  const returnRequest = await ReturnRequest.findById(returnId);
  if (!returnRequest) {
    throw ApiError.notFound('Return request not found');
  }
  return returnRequest;
}

export interface ReturnListResult {
  returns: ReturnRequestDocument[];
  nextCursor: string | null;
}

export async function listReturnsForUser(
  userId: string,
  query: ListReturnsQuery,
): Promise<ReturnListResult> {
  const limit = clampLimit(query.limit);
  const filter: Record<string, unknown> = { user: userId };
  if (query.status) filter.status = query.status;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (!decoded) throw ApiError.badRequest('Invalid pagination cursor');
    filter._id = { $lt: decoded };
  }

  const returns = await ReturnRequest.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1);
  const hasMore = returns.length > limit;
  const page = hasMore ? returns.slice(0, limit) : returns;
  const last = page[page.length - 1];
  return { returns: page, nextCursor: hasMore && last ? encodeCursor(last._id) : null };
}

export async function listAllReturns(query: ListReturnsQuery): Promise<ReturnListResult> {
  const limit = clampLimit(query.limit);
  const filter: Record<string, unknown> = {};
  if (query.status) filter.status = query.status;
  if (query.cursor) {
    const decoded = decodeCursor(query.cursor);
    if (!decoded) throw ApiError.badRequest('Invalid pagination cursor');
    filter._id = { $lt: decoded };
  }

  const returns = await ReturnRequest.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .populate('user', 'name email');
  const hasMore = returns.length > limit;
  const page = hasMore ? returns.slice(0, limit) : returns;
  const last = page[page.length - 1];
  return { returns: page, nextCursor: hasMore && last ? encodeCursor(last._id) : null };
}

export async function adminUpdateReturnStatus(
  returnId: string,
  input: UpdateReturnStatusInput,
  adminId: string,
): Promise<ReturnRequestDocument> {
  const returnRequest = await getReturnByIdForAdmin(returnId);
  assertValidReturnTransition(returnRequest.status, input.status);

  returnRequest.status = input.status;
  if (input.adminNote !== undefined) returnRequest.adminNote = input.adminNote;
  returnRequest.statusHistory.push({
    status: input.status,
    note: input.adminNote,
    changedAt: new Date(),
    changedBy: adminId as unknown as ReturnRequestDocument['statusHistory'][number]['changedBy'],
  });
  await returnRequest.save();

  const order = await Order.findById(returnRequest.order);
  if (order) {
    await triggerReturnStatusEmail(returnRequest, order);
  }
  return returnRequest;
}
