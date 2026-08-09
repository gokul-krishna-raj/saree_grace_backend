import { Router } from 'express';
import { requireAuth, requireAdmin } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import * as returnController from './return.controller';
import {
  returnIdParamSchema,
  listReturnsQuerySchema,
  updateReturnStatusSchema,
} from './return.validation';

const router = Router();

router.use(requireAuth, requireAdmin);

router.get('/', validate({ query: listReturnsQuerySchema }), returnController.listAllReturns);
router.get('/:id', validate({ params: returnIdParamSchema }), returnController.getReturnForAdmin);
router.patch(
  '/:id/status',
  validate({ params: returnIdParamSchema, body: updateReturnStatusSchema }),
  returnController.updateReturnStatus,
);

export default router;
