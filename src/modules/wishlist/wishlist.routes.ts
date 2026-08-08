import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import * as wishlistController from './wishlist.controller';
import { productIdParamSchema } from './wishlist.validation';

const router = Router();

router.use(requireAuth);

router.get('/', wishlistController.getWishlist);
router.post(
  '/:productId',
  validate({ params: productIdParamSchema }),
  wishlistController.addToWishlist,
);
router.delete(
  '/:productId',
  validate({ params: productIdParamSchema }),
  wishlistController.removeFromWishlist,
);

export default router;
