import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { uploadImages } from '../../middlewares/upload';
import * as reviewController from './review.controller';
import { createReviewSchema } from './review.validation';

const router = Router();

router.post(
  '/',
  requireAuth,
  uploadImages.array('images', 5),
  validate({ body: createReviewSchema }),
  reviewController.createReview,
);

export default router;
