import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import * as cartController from './cart.controller';
import {
  addCartItemSchema,
  updateCartItemSchema,
  cartItemParamSchema,
  mergeGuestCartSchema,
} from './cart.validation';

const router = Router();

router.use(requireAuth);

router.get('/', cartController.getCart);
router.post('/', validate({ body: addCartItemSchema }), cartController.addItem);
router.post('/merge', validate({ body: mergeGuestCartSchema }), cartController.mergeGuestCart);
router.patch(
  '/:itemId',
  validate({ params: cartItemParamSchema, body: updateCartItemSchema }),
  cartController.updateItem,
);
router.delete('/:itemId', validate({ params: cartItemParamSchema }), cartController.removeItem);

export default router;
