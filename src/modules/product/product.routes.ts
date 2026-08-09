import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import * as productController from './product.controller';
import { listReviewsForProduct } from '../review/review.controller';
import {
  listProductsQuerySchema,
  searchProductsQuerySchema,
  listBestSellersQuerySchema,
  slugParamSchema,
} from './product.validation';
import { productIdParamSchema } from './product.validation';
import { listReviewsQuerySchema } from '../review/review.validation';

const router = Router();

router.get('/', validate({ query: listProductsQuerySchema }), productController.listProducts);
router.get(
  '/search',
  validate({ query: searchProductsQuerySchema }),
  productController.searchProducts,
);
router.get(
  '/best-sellers',
  validate({ query: listBestSellersQuerySchema }),
  productController.listBestSellers,
);
router.get(
  '/:id/reviews',
  validate({ params: productIdParamSchema, query: listReviewsQuerySchema }),
  listReviewsForProduct,
);
router.get('/:slug', validate({ params: slugParamSchema }), productController.getProductBySlug);

export default router;
