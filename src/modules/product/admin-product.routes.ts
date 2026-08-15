import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { uploadImages } from '../../middlewares/upload';
import * as productController from './product.controller';
import {
  createProductSchema,
  updateProductSchema,
  addVariantSchema,
  updateVariantSchema,
  productIdParamSchema,
  variantParamSchema,
} from './product.validation';

const router = Router();

router.use(requireAuth, requireAdmin);

router.post(
  '/',
  uploadImages.array('images', 10),
  validate({ body: createProductSchema }),
  productController.createProduct,
);

router.put(
  '/:id',
  uploadImages.array('images', 10),
  validate({ params: productIdParamSchema, body: updateProductSchema }),
  productController.updateProduct,
);

router.delete('/:id', validate({ params: productIdParamSchema }), productController.deleteProduct);

router.post(
  '/:id/variants',
  uploadImages.array('images', 10),
  validate({ params: productIdParamSchema, body: addVariantSchema }),
  productController.addVariant,
);

router.patch(
  '/:id/variants/:variantId',
  uploadImages.array('images', 10),
  validate({ params: variantParamSchema, body: updateVariantSchema }),
  productController.updateVariant,
);

router.delete(
  '/:id/variants/:variantId',
  validate({ params: variantParamSchema }),
  productController.deleteVariant,
);

export default router;
