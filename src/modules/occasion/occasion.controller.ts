import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import * as occasionService from './occasion.service';
import { CreateOccasionInput, UpdateOccasionInput } from './occasion.validation';

function fileFromRequest(req: Request): Express.Multer.File | undefined {
  return req.file as Express.Multer.File | undefined;
}

export const createOccasion = asyncHandler(async (req: Request, res: Response) => {
  const occasion = await occasionService.createOccasion(
    req.body as CreateOccasionInput,
    fileFromRequest(req),
  );
  sendSuccess(res, { occasion }, 201);
});

export const updateOccasion = asyncHandler(async (req: Request, res: Response) => {
  const occasion = await occasionService.updateOccasion(
    req.params.id as string,
    req.body as UpdateOccasionInput,
    fileFromRequest(req),
  );
  sendSuccess(res, { occasion });
});

export const deleteOccasion = asyncHandler(async (req: Request, res: Response) => {
  await occasionService.deleteOccasion(req.params.id as string);
  sendSuccess(res, { message: 'Occasion deleted' });
});

export const listOccasions = asyncHandler(async (_req: Request, res: Response) => {
  const occasions = await occasionService.listOccasionsFlat();
  sendSuccess(res, { occasions });
});
