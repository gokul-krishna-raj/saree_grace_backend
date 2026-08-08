import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import * as orderService from './order.service';
import { CreateOrderInput, ListOrdersQuery, UpdateOrderStatusInput } from './order.validation';

function requireUserId(req: Request): string {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.id;
}

export const createOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.createOrderFromCart(
    requireUserId(req),
    req.body as CreateOrderInput,
  );
  sendSuccess(res, { order }, 201);
});

export const listMyOrders = asyncHandler(async (req: Request, res: Response) => {
  const result = await orderService.listOrdersForUser(
    requireUserId(req),
    req.query as unknown as ListOrdersQuery,
  );
  sendSuccess(res, { orders: result.orders }, 200, { nextCursor: result.nextCursor });
});

export const getMyOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.getOrderByIdForUser(req.params.id as string, requireUserId(req));
  sendSuccess(res, { order });
});

export const getMyOrderTracking = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.getOrderByIdForUser(req.params.id as string, requireUserId(req));
  sendSuccess(res, {
    status: order.status,
    tracking: order.tracking,
    statusHistory: order.statusHistory,
  });
});

export const cancelMyOrder = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.cancelOwnOrder(req.params.id as string, requireUserId(req));
  sendSuccess(res, { order });
});

export const listAllOrders = asyncHandler(async (req: Request, res: Response) => {
  const result = await orderService.listAllOrders(req.query as unknown as ListOrdersQuery);
  sendSuccess(res, { orders: result.orders }, 200, { nextCursor: result.nextCursor });
});

export const getOrderForAdmin = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.getOrderByIdForAdmin(req.params.id as string);
  sendSuccess(res, { order });
});

export const updateOrderStatus = asyncHandler(async (req: Request, res: Response) => {
  const order = await orderService.adminUpdateOrderStatus(
    req.params.id as string,
    req.body as UpdateOrderStatusInput,
    requireUserId(req),
  );
  sendSuccess(res, { order });
});
