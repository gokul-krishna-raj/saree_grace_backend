import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import * as orderController from './order.controller';
import {
  orderIdParamSchema,
  listOrdersQuerySchema,
  updateOrderStatusSchema,
} from './order.validation';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/', validate({ query: listOrdersQuerySchema }), orderController.listAllOrders);
router.get('/:id', validate({ params: orderIdParamSchema }), orderController.getOrderForAdmin);
router.patch(
  '/:id/status',
  validate({ params: orderIdParamSchema, body: updateOrderStatusSchema }),
  orderController.updateOrderStatus,
);

export default router;
