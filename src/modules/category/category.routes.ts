import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { requireAuth, requireAdmin } from '../../middlewares/auth';
import { uploadImages } from '../../middlewares/upload';
import * as categoryController from './category.controller';
import {
  createCategorySchema,
  updateCategorySchema,
  categoryIdParamSchema,
  listCategoriesQuerySchema,
} from './category.validation';

const router = Router();

router.get('/', validate({ query: listCategoriesQuerySchema }), categoryController.listCategories);

router.post(
  '/',
  requireAuth,
  requireAdmin,
  uploadImages.single('image'),
  validate({ body: createCategorySchema }),
  categoryController.createCategory,
);
router.put(
  '/:id',
  requireAuth,
  requireAdmin,
  uploadImages.single('image'),
  validate({ params: categoryIdParamSchema, body: updateCategorySchema }),
  categoryController.updateCategory,
);
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  validate({ params: categoryIdParamSchema }),
  categoryController.deleteCategory,
);

export default router;
