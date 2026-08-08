import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import * as categoryService from './category.service';
import { CreateCategoryInput, UpdateCategoryInput } from './category.validation';

export const createCategory = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoryService.createCategory(req.body as CreateCategoryInput);
  sendSuccess(res, { category }, 201);
});

export const updateCategory = asyncHandler(async (req: Request, res: Response) => {
  const category = await categoryService.updateCategory(
    req.params.id as string,
    req.body as UpdateCategoryInput,
  );
  sendSuccess(res, { category });
});

export const deleteCategory = asyncHandler(async (req: Request, res: Response) => {
  await categoryService.deleteCategory(req.params.id as string);
  sendSuccess(res, { message: 'Category deleted' });
});

export const listCategories = asyncHandler(async (req: Request, res: Response) => {
  const wantsTree = (req.query as unknown as { tree?: boolean }).tree === true;
  if (wantsTree) {
    const tree = await categoryService.listCategoriesTree();
    sendSuccess(res, { categories: tree });
    return;
  }
  const categories = await categoryService.listCategoriesFlat();
  sendSuccess(res, { categories });
});
