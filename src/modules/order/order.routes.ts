import { Router } from 'express';
import { requireAuth } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import * as orderController from './order.controller';
import { createOrderSchema, orderIdParamSchema, listOrdersQuerySchema } from './order.validation';

const router = Router();

router.use(requireAuth);

router.post('/', validate({ body: createOrderSchema }), orderController.createOrder);
router.get('/my', validate({ query: listOrdersQuerySchema }), orderController.listMyOrders);
router.get('/:id', validate({ params: orderIdParamSchema }), orderController.getMyOrder);
router.get(
  '/:id/tracking',
  validate({ params: orderIdParamSchema }),
  orderController.getMyOrderTracking,
);
router.post('/:id/cancel', validate({ params: orderIdParamSchema }), orderController.cancelMyOrder);

export default router;
