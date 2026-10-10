import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { uploadImages } from '../../middlewares/upload';
import * as productController from './product.controller';
import * as productIoController from './product-io.controller';
import {
  createProductSchema,
  updateProductSchema,
  addVariantSchema,
  updateVariantSchema,
  productIdParamSchema,
  variantParamSchema,
  productImportPreviewSchema,
  productImportCommitSchema,
} from './product.validation';

const router = Router();

router.use(requireAuth, requireAdmin);

// Bulk CSV export/import — registered before the /:id routes so "export"
// and "import" are never captured as an :id.
router.get('/export', productIoController.exportProducts);
router.get('/import/template', productIoController.getImportTemplate);
router.post(
  '/import/preview',
  validate({ body: productImportPreviewSchema }),
  productIoController.previewImport,
);
router.post(
  '/import/commit',
  validate({ body: productImportCommitSchema }),
  productIoController.commitImport,
);

router.post(
  '/',
  uploadImages.any(),
  validate({ body: createProductSchema }),
  productController.createProduct,
);

router.put(
  '/:id',
  uploadImages.any(),
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
