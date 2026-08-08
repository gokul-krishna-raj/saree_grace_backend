import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import * as reviewController from './review.controller';
import { adminListReviewsQuerySchema, reviewIdParamSchema } from './review.validation';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get(
  '/',
  validate({ query: adminListReviewsQuerySchema }),
  reviewController.adminListReviews,
);
router.patch(
  '/:id/approve',
  validate({ params: reviewIdParamSchema }),
  reviewController.adminApproveReview,
);
router.delete(
  '/:id',
  validate({ params: reviewIdParamSchema }),
  reviewController.adminDeleteReview,
);

export default router;
