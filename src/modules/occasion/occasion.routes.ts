import { Router } from 'express';
import { validate } from '../../middlewares/validate';
import { requireAuth, requireAdmin } from '../../middlewares/auth';
import { uploadImages } from '../../middlewares/upload';
import * as occasionController from './occasion.controller';
import {
  createOccasionSchema,
  updateOccasionSchema,
  occasionIdParamSchema,
} from './occasion.validation';

const router = Router();

router.get('/', occasionController.listOccasions);

router.post(
  '/',
  requireAuth,
  requireAdmin,
  uploadImages.single('image'),
  validate({ body: createOccasionSchema }),
  occasionController.createOccasion,
);
router.put(
  '/:id',
  requireAuth,
  requireAdmin,
  uploadImages.single('image'),
  validate({ params: occasionIdParamSchema, body: updateOccasionSchema }),
  occasionController.updateOccasion,
);
router.delete(
  '/:id',
  requireAuth,
  requireAdmin,
  validate({ params: occasionIdParamSchema }),
  occasionController.deleteOccasion,
);

export default router;
