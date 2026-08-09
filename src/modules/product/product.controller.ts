import { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { sendSuccess } from '../../utils/ApiResponse';
import { ApiError } from '../../utils/ApiError';
import * as productService from './product.service';
import {
  CreateSimpleProductInput,
  CreateVariantShellInput,
  UpdateProductInput,
  AddVariantInput,
  UpdateVariantInput,
  ListProductsQuery,
} from './product.validation';

function filesFromRequest(req: Request): Express.Multer.File[] {
  if (Array.isArray(req.files)) return req.files;
  return [];
}

export const createProduct = asyncHandler(async (req: Request, res: Response) => {
  const files = filesFromRequest(req);
  if (req.body.type === 'simple') {
    const product = await productService.createSimpleProduct(
      req.body as CreateSimpleProductInput,
      files,
    );
    sendSuccess(res, { product }, 201);
    return;
  }
  const product = await productService.createVariantShellProduct(
    req.body as CreateVariantShellInput,
  );
  sendSuccess(res, { product }, 201);
});

export const updateProduct = asyncHandler(async (req: Request, res: Response) => {
  const files = filesFromRequest(req);
  const product = await productService.updateProduct(
    req.params.id as string,
    req.body as UpdateProductInput,
    files,
  );
  sendSuccess(res, { product });
});

export const deleteProduct = asyncHandler(async (req: Request, res: Response) => {
  await productService.deleteProduct(req.params.id as string);
  sendSuccess(res, { message: 'Product deleted' });
});

export const addVariant = asyncHandler(async (req: Request, res: Response) => {
  const files = filesFromRequest(req);
  const product = await productService.addVariant(
    req.params.id as string,
    req.body as AddVariantInput,
    files,
  );
  sendSuccess(res, { product }, 201);
});

export const updateVariant = asyncHandler(async (req: Request, res: Response) => {
  const files = filesFromRequest(req);
  const product = await productService.updateVariant(
    req.params.id as string,
    req.params.variantId as string,
    req.body as UpdateVariantInput,
    files,
  );
  sendSuccess(res, { product });
});

export const deleteVariant = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.deleteVariant(
    req.params.id as string,
    req.params.variantId as string,
  );
  sendSuccess(res, { product });
});

export const getProductBySlug = asyncHandler(async (req: Request, res: Response) => {
  const product = await productService.getProductBySlug(req.params.slug as string);
  sendSuccess(res, { product });
});

export const listProducts = asyncHandler(async (req: Request, res: Response) => {
  const result = await productService.listProducts(req.query as unknown as ListProductsQuery);
  sendSuccess(res, { products: result.products }, 200, { nextCursor: result.nextCursor });
});

export const searchProducts = asyncHandler(async (req: Request, res: Response) => {
  const { q, cursor, limit } = req.query as { q: string; cursor?: string; limit?: string };
  if (!q) {
    throw ApiError.badRequest('Query parameter "q" is required');
  }
  const result = await productService.searchProducts(q, cursor, limit);
  sendSuccess(res, { products: result.products }, 200, { nextCursor: result.nextCursor });
});

export const listBestSellers = asyncHandler(async (req: Request, res: Response) => {
  const { limit } = req.query as { limit?: string };
  const products = await productService.listBestSellers(limit);
  sendSuccess(res, { products });
});
