import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import * as returnService from './return.service';
import {
  CreateReturnRequestInput,
  ListReturnsQuery,
  UpdateReturnStatusInput,
} from './return.validation';

function requireUserId(req: Request): string {
  if (!req.user) throw ApiError.unauthorized();
  return req.user.id;
}

export const createReturnRequest = asyncHandler(async (req: Request, res: Response) => {
  const returnRequest = await returnService.createReturnRequest(
    requireUserId(req),
    req.body as CreateReturnRequestInput,
  );
  sendSuccess(res, { returnRequest }, 201);
});

export const listMyReturns = asyncHandler(async (req: Request, res: Response) => {
  const result = await returnService.listReturnsForUser(
    requireUserId(req),
    req.query as unknown as ListReturnsQuery,
  );
  sendSuccess(res, { returns: result.returns }, 200, { nextCursor: result.nextCursor });
});

export const getMyReturn = asyncHandler(async (req: Request, res: Response) => {
  const returnRequest = await returnService.getReturnByIdForUser(
    req.params.id as string,
    requireUserId(req),
  );
  sendSuccess(res, { returnRequest });
});

export const listAllReturns = asyncHandler(async (req: Request, res: Response) => {
  const result = await returnService.listAllReturns(req.query as unknown as ListReturnsQuery);
  sendSuccess(res, { returns: result.returns }, 200, { nextCursor: result.nextCursor });
});

export const getReturnForAdmin = asyncHandler(async (req: Request, res: Response) => {
  const returnRequest = await returnService.getReturnByIdForAdmin(req.params.id as string);
  sendSuccess(res, { returnRequest });
});

export const updateReturnStatus = asyncHandler(async (req: Request, res: Response) => {
  const returnRequest = await returnService.adminUpdateReturnStatus(
    req.params.id as string,
    req.body as UpdateReturnStatusInput,
    requireUserId(req),
  );
  sendSuccess(res, { returnRequest });
});
